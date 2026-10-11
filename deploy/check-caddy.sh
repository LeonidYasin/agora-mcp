#!/usr/bin/env bash
# Validate the checked-in example only; does not access or reload VPS Caddy.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
docker run --rm   -v "$HERE/Caddyfile.example:/etc/caddy/Caddyfile:ro"   caddy:2.10.2 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
