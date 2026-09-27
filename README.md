# agora-mcp

**MCP server for a bilateral offer/want marketplace.** Connect your own AI agent (Claude, etc.) to a shared pool of offers and requests, and let it find matches for you through natural language — no separate app needed.

A practical, implementation-first spin-off of the ideas behind [NoKing](https://github.com/LeonidYasin/NoKing) (a protocol for bilateral value exchange), kept as its own repo so it doesn't entangle with [Civis](https://github.com/LeonidYasin/civis) (values-based people matching).

## Idea in one line

You talk to your own AI agent about what you have and what you need. Your agent calls this MCP server to publish that as an *offer* and/or a *want*, and to search for matches. Matching runs on embeddings, computed server-side from a distilled text profile — not client-side, so every user's data lands in the same comparable vector space regardless of which AI they use.

## Status

Stage 0 (bootstrap): single VPS, single Postgres+pgvector instance, no behavioral ranking yet, invite-only growth. See `docs/architecture.md` for the full design and growth trajectory.

Tool output follows the shared **`synapse/v0`** schema (`docs/synapse-protocol.md`), so it's interoperable with the rest of the author's project ecosystem (NoKing, Civis, synapse2, mcp-server).

## Repo layout

```
agora-mcp/
├── mcp-server/        # MCP tool definitions + server (submit_offer, submit_want, search_matches, ...)
├── db/
│   └── migrations/    # Postgres + pgvector schema
├── docs/               # architecture, growth plan, MCP tool contracts
```

## Running Stage 0

```bash
cd mcp-server
npm install

# 1. Postgres + pgvector, then apply migrations in order:
psql "$DATABASE_URL" -f ../db/migrations/001_init.sql
psql "$DATABASE_URL" -f ../db/migrations/002_auth_and_protocol_alignment.sql

# 2. Invite a user (Stage 0 is invite-only — see docs/architecture.md):
#    generate a random token yourself, store its SHA-256 hash, hand the
#    raw token to the invitee out-of-band.
psql "$DATABASE_URL" -c "INSERT INTO users (external_id, display_name, token_hash) \
  VALUES ('leonid', 'Leonid', encode(digest('<raw-token>', 'sha256'), 'hex'));"

# 3. Environment
export DATABASE_URL=postgres://user:pass@localhost:5432/agora
export EMBEDDING_PROVIDER=ollama          # or: openai
export EMBEDDING_MODEL=nomic-embed-text   # must match items.embedding's vector(1024) dimension
# export EMBEDDING_BASE_URL=...           # optional override
# export EMBEDDING_API_KEY=...            # required for EMBEDDING_PROVIDER=openai

npm run build && npm start   # or: npm run dev
```

Server listens on `http://127.0.0.1:3010/mcp` by default (`HOST`/`PORT` env vars to
change). `GET /health` for a liveness check.

Every tool call must carry `Authorization: Bearer <raw-token>` for a token issued as
above.

## Docs

- [`docs/architecture.md`](docs/architecture.md) — full architecture and growth trajectory (Stage 0 → Stage 4)
- [`docs/mcp-tools.md`](docs/mcp-tools.md) — MCP tool contracts (inputs/outputs)
- [`docs/synapse-protocol.md`](docs/synapse-protocol.md) — shared wire schema across the project ecosystem
