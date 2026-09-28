#!/usr/bin/env bash
# End-to-end smoke test: real Postgres+pgvector, real agora-mcp server, FAKE embedder.
# Verifies plumbing (auth, DB, pgvector search, protocol shape, isolation) — NOT the
# semantic quality of a real embedding model. See e2e/README.md.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$(cd "$HERE/.." && pwd)"

: "${DATABASE_URL:?set DATABASE_URL to a DEDICATED TEST database, e.g. postgres://agora:pw@127.0.0.1:5432/agora_test}"
DBNAME="${DATABASE_URL##*/}"; DBNAME="${DBNAME%%\?*}"
case "$DBNAME" in
  *_test) ;;
  *) echo "REFUSING to run: this script TRUNCATEs users/items/matches, and database '$DBNAME'"
     echo "does not end in '_test'. Point DATABASE_URL at a throwaway test database."; exit 2 ;;
esac
[ -f "$SERVER_DIR/dist/index.js" ] || { echo "dist/ missing — run 'npm run build' in mcp-server/ first"; exit 2; }

FAKE_PORT="${FAKE_OLLAMA_PORT:-11435}"
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -c "TRUNCATE users CASCADE;" \
  -c "INSERT INTO users (external_id, display_name, token_hash) VALUES
        ('alice','Alice', encode(digest('alice-secret-token','sha256'),'hex')),
        ('bob','Bob',     encode(digest('bob-secret-token','sha256'),'hex'));" \
  || { echo "could not seed users (are migrations 001+002 applied, and pgcrypto enabled?)"; exit 2; }

python3 "$HERE/fake_ollama.py" "$FAKE_PORT" & OLL=$!
( cd "$SERVER_DIR" && EMBEDDING_PROVIDER=ollama EMBEDDING_BASE_URL="http://127.0.0.1:$FAKE_PORT" \
  EMBEDDING_MODEL=bge-m3 node dist/index.js > "$HERE/server.log" 2>&1 ) & SRV=$!
trap 'kill $SRV $OLL 2>/dev/null' EXIT
for _ in $(seq 1 20); do curl -s http://127.0.0.1:3010/health >/dev/null && break; sleep 0.3; done

python3 "$HERE/client.py"; RC=$?
[ $RC -ne 0 ] && { echo "--- server log ---"; cat "$HERE/server.log"; }
exit $RC
