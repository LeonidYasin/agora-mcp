# Architecture

## Stage 0 — bootstrap (current)

Single VPS. No P2P, no distributed anything — premature at this scale, and there's no
established MCP-native way to publish/query a P2P network yet, so it would mean designing
that layer from scratch for no payoff at this stage.

```
User's AI agent (Claude / other)
        │  MCP over HTTP (OAuth)
        ▼
MCP server  (tools: submit_offer, submit_want, search_matches, get_my_items)
        │
        ▼
Backend API (auth, validation, rate limiting)
        │
        ├──► Embedding service (single shared model — see below)
        │
        ▼
Postgres + pgvector (users, items, embeddings, matches)
```

Growth in this stage is invite-only: people invite others they already want to exchange
with (network effect, not a waitlist gimmick). This also solves cold start for trust —
early exchanges happen between people who already know each other, before cross-network
AI-suggested matches are reliable enough to trust.

## Profile / item storage

The core design decision: **don't store one embedding per user.** Store one embedding per
*item*, where an item is either an `offer` or a `want`, and a user can have many of each.

```sql
items(user_id, type: offer|want, raw_text, category, tags, embedding, active, created_at)
```

Matching is asymmetric, not a plain similarity search: an `offer` should be matched against
other users' `want`s, not against other `offer`s. This mirrors reciprocal-recommendation
systems (dating, hiring) more than plain semantic search.

- **Embedding model:** multilingual (Leonid's users write in Russian and English), and
  ideally instruction-aware (e.g. BGE-M3 / multilingual-e5-large, or a hosted multilingual
  model) — encode `offer` text and `want` text with different instruction prefixes, since
  role-aware asymmetric embeddings measurably improve this kind of crossed matching versus
  raw, un-prefixed embeddings.
- **Hybrid search:** pure cosine similarity surfaces things that are semantically adjacent
  but practically useless (e.g. "looking for an English tutor" vs. "offering Spanish
  lessons"). Combine vector ranking with structured filters (category, tags, geography).
- **Freshness:** items get `updated_at` and an `active` flag; stale, unconfirmed offers
  should decay out of matching rather than accumulate forever.

## Growth trajectory

**Stage 0 — bootstrap.** As above. Manual/semi-manual seeding of the item pool by the
founder and first testers. Matching is pure text semantics — no behavioral signal yet.

**Stage 1 — first cross-network matches.** Enough item density that matches start
happening between people who don't already know each other. Add hybrid (vector + metadata)
search. Critically: start capturing outcome feedback (did the exchange happen, was it
useful) — nothing in Stage 2 is possible without this signal existing.

**Stage 2 — behavioral ranking layer.** Two-stage retrieval, same shape as production
recommender systems (YouTube, Ozon, Facebook Search-style embedding retrieval): cheap
vector search for candidate generation, a lightweight ranking step on top that weighs
real outcomes (completed exchanges, response rate), not just text similarity.

**Stage 3 — infrastructure scale + agent-to-agent protocols.** Move off a single
pgvector instance if volume demands it (dedicated vector engine, sharding). This is also
the natural point to look at Google's A2A protocol for the negotiation step *after* a
match is found — A2A is a communication layer between agents, not a discovery/matching
layer, so it complements this system rather than replacing it.

**Stage 4 — institutional layer.** Reputation, trust, dispute resolution — once there's
real transaction volume worth protecting. P2P/decentralization belongs here too, driven
by a concrete need (censorship resistance), not by default.
