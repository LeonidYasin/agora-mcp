"""End-to-end smoke test for agora-mcp: real MCP JSON-RPC calls against a running
server + real Postgres. Driven by run.sh — see e2e/README.md."""
import json
import os
import subprocess
import sys
import urllib.request

URL = os.environ.get("AGORA_URL", "http://127.0.0.1:3010/mcp")
TOK_A, TOK_B = "alice-secret-token", "bob-secret-token"
results = []


def check(label, cond, detail=""):
    results.append(cond)
    print(("PASS " if cond else "FAIL ") + label + ("" if cond else f"\n     -> {detail}"))


_id = 0


def call(tool, args, token=None):
    global _id
    _id += 1
    headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps({"jsonrpc": "2.0", "id": _id, "method": "tools/call",
                       "params": {"name": tool, "arguments": args}}).encode()
    req = urllib.request.Request(URL, data=body, headers=headers)
    raw = urllib.request.urlopen(req).read().decode()
    data = next(l[5:] for l in raw.splitlines() if l.startswith("data:"))
    res = json.loads(data)["result"]
    payload = json.loads(res["content"][0]["text"])
    return payload, bool(res.get("isError"))


def psql(sql):
    out = subprocess.run(["psql", os.environ["DATABASE_URL"], "-At", "-c", sql],
                         capture_output=True, text=True)
    return out.stdout.strip()


alice_id = psql("select id from users where external_id='alice'")
bob_id = psql("select id from users where external_id='bob'")

# --- auth ---
p, err = call("get_my_items", {})
check("no auth header -> error", err and "Missing Authorization" in p["error"], p)
p, err = call("get_my_items", {}, token="nope")
check("bad token -> error", err and "Invalid or unrecognized" in p["error"], p)

# --- submit ---
a_off, e1 = call("submit_offer", {"text": "Консультации по Android разработке, Kotlin и NDK", "category": "it", "tags": ["android", "kotlin"], "geo": "Kerkrade"}, TOK_A)
a_want, e2 = call("submit_want", {"text": "Ищу репетитора по английскому языку"}, TOK_A)
b_want_android, e3 = call("submit_want", {"text": "Нужен консультант по Android разработке на Kotlin"}, TOK_B)
b_off_english, e4 = call("submit_offer", {"text": "Преподаю английский язык, разговорная практика"}, TOK_B)
b_want_tile, e5 = call("submit_want", {"text": "Ищу плиточника для ремонта ванной комнаты"}, TOK_B)
check("5 submits succeed", not any([e1, e2, e3, e4, e5]), [a_off, a_want, b_want_android, b_off_english, b_want_tile])
ids = {k: v.get("item_id") for k, v in dict(a_off=a_off, a_want=a_want, b_android=b_want_android, b_english=b_off_english, b_tile=b_want_tile).items()}
check("item_ids are uuids", all(ids.values()) and all(len(i) == 36 for i in ids.values()), ids)

# --- embeddings really stored with right dim + role-prefixed input reached the embedder ---
check("stored embedding dim == 1024", psql(f"select vector_dims(embedding) from items where id='{ids['a_off']}'") == "1024")

# --- matching ---
m, err = call("search_matches", {"item_id": ids["a_off"]}, TOK_A)
matches = m.get("matches", [])
check("returns exactly Bob's 2 wants (opposite type only, NOT Alice's own want)",
      len(matches) == 2 and all(x["owner_b"] == bob_id for x in matches), m)
check("no self-matches anywhere (owner_a != owner_b)", all(x["owner_a"] != x["owner_b"] for x in matches), matches)
check("top match is Bob's Android want", matches and matches[0]["item_b"] == ids["b_android"], matches[:1])
check("ranking: android want scores above tile want",
      len(matches) == 2 and matches[0]["score"] > matches[1]["score"], [x["score"] for x in matches])
top = matches[0]
check("match follows synapse/v0 shape",
      set(top) == {"schema", "match_id", "item_a", "item_b", "owner_a", "owner_b", "score", "source", "created_at", "outcome"}
      and top["schema"] == "synapse/v0" and top["source"] == "embedding" and top["outcome"] == "unknown", top)
check("item_a is the offer, owners correct", top["item_a"] == ids["a_off"] and top["owner_a"] == alice_id and top["owner_b"] == bob_id, top)
check("score is a number in [0,1]", isinstance(top["score"], float) and 0 <= top["score"] <= 1, top["score"])

m2, _ = call("search_matches", {"item_id": ids["a_off"]}, TOK_A)
check("re-search: same match_id (upsert, no dupes)", m2["matches"][0]["match_id"] == top["match_id"])
check("matches table has exactly 1 row for that pair",
      psql(f"select count(*) from matches where offer_item_id='{ids['a_off']}' and want_item_id='{ids['b_android']}'") == "1")

mw, _ = call("search_matches", {"item_id": ids["a_want"]}, TOK_A)
check("Alice's want -> Bob's English offer is top; item_a=offer side",
      mw["matches"][0]["item_a"] == ids["b_english"] and mw["matches"][0]["item_b"] == ids["a_want"], mw["matches"][:1])

# --- get_my_items ---
gi, _ = call("get_my_items", {}, TOK_A)
items = gi["items"]
check("get_my_items: only Alice's 2 items, synapse shape",
      len(items) == 2 and all(i["owner_id"] == alice_id and i["schema"] == "synapse/v0" for i in items), items)
offer = next(i for i in items if i["type"] == "offer")
check("item fields mapped (text/geo/tags/category)",
      offer["text"].startswith("Консультации") and offer["geo"] == "Kerkrade" and offer["tags"] == ["android", "kotlin"] and offer["category"] == "it", offer)

# --- isolation / deactivate ---
d, err_d = call("deactivate_item", {"item_id": ids["a_off"]}, TOK_B)  # Bob tries to deactivate Alice's item
check("Bob cannot deactivate Alice's item: error + row still active",
      err_d and psql(f"select active from items where id='{ids['a_off']}'") == "t", d)

d, err_ok = call("deactivate_item", {"item_id": ids["b_android"]}, TOK_B)
check("owner can deactivate own item -> ok:true", d == {"ok": True} and not err_ok, d)
d2, err_twice = call("deactivate_item", {"item_id": ids["b_android"]}, TOK_B)
check("deactivating twice -> error (no false success)", err_twice, d2)
m3, _ = call("search_matches", {"item_id": ids["a_off"]}, TOK_A)
check("deactivated item disappears from matches", all(x["item_b"] != ids["b_android"] for x in m3["matches"]), m3)

# --- cross-user search: can Bob search matches for ALICE's item id? ---
x, err = call("search_matches", {"item_id": ids["a_want"]}, TOK_B)
check("Bob searching with Alice's item_id is REJECTED (no leak)", err and "matches" not in x, x)
check("...error is identical to a nonexistent item (can't probe ids)",
      x == call("search_matches", {"item_id": "00000000-0000-0000-0000-000000000000"}, TOK_B)[0], x)
x, err = call("search_matches", {"item_id": ids["b_android"]}, TOK_B)
check("searching from an inactive (withdrawn) item is rejected", err, x)

# --- garbage input ---
g, err = call("search_matches", {"item_id": "not-a-uuid"}, TOK_A)
check("invalid item_id -> clean error, server survives", err, g)
g, err = call("get_my_items", {}, TOK_A)
check("server still healthy after bad input", not err)

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
