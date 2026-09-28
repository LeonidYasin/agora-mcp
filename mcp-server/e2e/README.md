# e2e smoke test

Real MCP JSON-RPC calls against a running agora-mcp server and a real Postgres+pgvector —
auth, embedding storage, pgvector matching, `synapse/v0` output shape, per-user isolation,
deactivation, bad input.

**The embedder is fake** (`fake_ollama.py`: hashed bag-of-words, Ollama `/api/embed`
compatible). So this proves the plumbing works end to end; it says nothing about how good
`bge-m3` (or any real model) is at matching.

```bash
# 1. A DEDICATED throwaway database with migrations 001 + 002 applied and the
#    vector + pgcrypto extensions enabled:
createdb -O agora agora_test
sudo -u postgres psql -d agora_test -c 'CREATE EXTENSION IF NOT EXISTS vector;'  # superuser-only, see main README
psql agora_test -f ../../db/migrations/001_init.sql -f ../../db/migrations/002_auth_and_protocol_alignment.sql

# 2. Build, then run:
cd .. && npm run build && cd e2e
DATABASE_URL=postgres://agora:pw@127.0.0.1:5432/agora_test ./run.sh
```

⚠️ `run.sh` **TRUNCATEs `users` (cascading to items/matches)**. It refuses to run unless the
database name ends in `_test`. Never point it at real data.

Needs: `psql`, `python3`, `curl`, `node` (built `dist/`). Uses ports 3010 (server) and 11435
(fake embedder; override with `FAKE_OLLAMA_PORT`).
