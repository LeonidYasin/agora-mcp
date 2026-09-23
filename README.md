# agora-mcp

**MCP server for a bilateral offer/want marketplace.** Connect your own AI agent (Claude, etc.) to a shared pool of offers and requests, and let it find matches for you through natural language — no separate app needed.

A practical, implementation-first spin-off of the ideas behind [NoKing](https://github.com/LeonidYasin/NoKing) (a protocol for bilateral value exchange), kept as its own repo so it doesn't entangle with [Civis](https://github.com/LeonidYasin/civis) (values-based people matching).

## Idea in one line

You talk to your own AI agent about what you have and what you need. Your agent calls this MCP server to publish that as an *offer* and/or a *want*, and to search for matches. Matching runs on embeddings, computed server-side from a distilled text profile — not client-side, so every user's data lands in the same comparable vector space regardless of which AI they use.

## Status

Stage 0 (bootstrap): single VPS, single Postgres+pgvector instance, no behavioral ranking yet, invite-only growth. See `docs/architecture.md` for the full design and growth trajectory.

## Repo layout

```
agora-mcp/
├── mcp-server/        # MCP tool definitions + server (submit_offer, submit_want, search_matches, ...)
├── db/
│   └── migrations/    # Postgres + pgvector schema
├── docs/               # architecture, growth plan, MCP tool contracts
```

## Docs

- [`docs/architecture.md`](docs/architecture.md) — full architecture and growth trajectory (Stage 0 → Stage 4)
- [`docs/mcp-tools.md`](docs/mcp-tools.md) — MCP tool contracts (inputs/outputs)
