# MCP tool contracts (Stage 0)

All tools are called by the user's own AI agent on their behalf. **Stage 0 auth is a
simple invite-only bearer token** (see docs/architecture.md's "invite-only" growth model),
not a full OAuth flow yet: `Authorization: Bearer <token>`, where the token was issued
out-of-band and its SHA-256 hash stored in `users.token_hash`. A proper OAuth connector
flow is future work once growth moves past manual invites.

Tool output is shaped to the shared **`synapse/v0`** schema
(`docs/synapse-protocol.md`) — every `item` and `match` object includes a `schema` field
and the field names match the protocol (`item_id`, `owner_id`, `text`, ... rather than
this server's internal `raw_text`, `user_id`, ...), so results are interoperable with the
rest of the project ecosystem (e.g. mcp-server's own `synapse` module) without a
translation layer on the consumer's side.

## `submit_offer`
Publish something the user has to offer.

| param | type | notes |
|---|---|---|
| `text` | string | free-form description, in the user's own words |
| `category` | string? | optional coarse category for filtering |
| `tags` | string[]? | optional |
| `geo` | string? | optional free-form location, for hybrid filtering (`synapse/v0` `item.geo`) |

Returns: `{ item_id }`

Server embeds `text` server-side with the `offer`-role instruction prefix (see
src/embeddings.ts) — the client never computes or sends an embedding itself, so every
item lands in the same comparable vector space regardless of which AI produced the text.
Requires `EMBEDDING_PROVIDER` to be configured (`ollama` or `openai`; see
src/embeddings.ts for the env vars).

## `submit_want`
Same shape as `submit_offer`, but for something the user is looking for. Embedded with the
`want`-role instruction prefix.

## `search_matches`
Find candidate matches for one of the user's items.

| param | type | notes |
|---|---|---|
| `item_id` | string | the item to search matches for |
| `limit` | number? | default 10, max 50 |

Returns: `{ matches: SynapseMatch[] }` — each match follows the protocol's `match` shape
(`schema`, `match_id`, `item_a` (offer), `item_b` (want), `owner_a`, `owner_b`, `score`,
`source: "embedding"`, `outcome`). Matches are upserted into the `matches` table on every
search, so `outcome` can be updated later (Stage 1/2 behavioral feedback — see
docs/architecture.md — writes to this same row instead of a new one).

## `get_my_items`
List the calling user's own active offers/wants.

Returns: `{ items: SynapseItem[] }`, each shaped per `docs/synapse-protocol.md`'s `item`
object.

## `deactivate_item`
Mark an item inactive (withdrawn, fulfilled, no longer relevant).

| param | type |
|---|---|
| `item_id` | string |

Returns: `{ ok: true }`

---

Not yet specified: `report_match_outcome` (write `matches.outcome` directly from client
feedback) and `contact_request` / `exchange` (see docs/synapse-protocol.md §2.4/§2.5) —
intentionally deferred to Stage 1/2 until there's a live matching loop to attach them to.
