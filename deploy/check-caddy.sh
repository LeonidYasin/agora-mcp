#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
for file in Caddyfile.example Caddyfile.shared.example Caddyfile.fresh.example; do
  docker run --rm -v "$HERE/$file:/etc/caddy/Caddyfile:ro" \
    caddy:2.10.2 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
done
