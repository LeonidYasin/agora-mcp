# Agora on the existing Ubuntu VPS: Caddy + systemd

Repository templates, not an executed deployment. Follow the working pattern documented in [mcp-server](https://github.com/LeonidYasin/mcp-server#7-пошаговый-деплой-на-ubuntu-vps-проверено-вживую): unprivileged service user, loopback listener, systemd, Caddy TLS, DuckDNS hostname. Agora is Node.js, not Gunicorn. No Docker is needed on the VPS; Docker is used only for CI configuration validation.

## Isolation and prerequisites

Before any live changes, inspect existing service names, listeners and Caddy imports, and obtain maintainer authorization. Do not print existing environment files or keys. Confirm Node 22, PostgreSQL/pgvector, available memory for bge-m3, disk space, DNS and ports 80/443. Keep the existing MCP service, domain and port untouched.

This template uses a separate `agora` Unix user without sudo, `/home/agora/agora-mcp`, `agora-mcp.service`, port 3011, database/role `agora`, and a separate public hostname. Check these names are free; adjust consistently if needed. Use an existing shared Ollama service only if its availability/capacity is sufficient; do not restart it blindly. Keep PostgreSQL and Ollama off the public Internet.

## 1. Application (admin + service user)

Under the administrator account, create the dedicated service user without sudo if it does not exist. Install Node 22 using the VPS's established package-management method; verify the executable path with `command -v node` and adapt the unit if it is not `/usr/bin/node`. Do not run the service as root or reuse the existing `mcp` user.

```bash
# admin; review before running on the real VPS
sudo adduser --disabled-password --gecos "" agora
sudo -u agora -H git clone https://github.com/LeonidYasin/agora-mcp.git /home/agora/agora-mcp
# Choose a reviewed immutable commit from main; do not deploy an unmerged PR.
sudo -u agora -H git -C /home/agora/agora-mcp checkout <REVIEWED_COMMIT_SHA>
sudo -u agora -H bash -c 'cd /home/agora/agora-mcp/mcp-server && npm ci && npm run build && npm test'
```

## 2. Dedicated database and environment

Use the README's PostgreSQL/pgvector instructions for a new Agora database/role only. Do not change the existing application's DB. Enable `vector` once as DB administrator, then apply migrations 001 and 002 against the Agora database with `ON_ERROR_STOP=1` using the limited application role. Back up any existing Agora data before future migrations.

Copy `agora.env.example` to `/etc/agora-mcp/agora.env` with root ownership and mode 0600 (directory 0700). Replace the password placeholder privately; URL-encode special password characters in DATABASE_URL. Use the actual DB/model endpoints. The root systemd manager reads this file before switching to the service user. Never commit the real file or paste its values into chat.

Keep one fixed embedding model for all existing items. A model change requires re-embedding, even with the same vector dimension. Create two invited users using random tokens and store only their SHA-256 hashes, per README. Deliver raw tokens privately. E2E fixture tokens are forbidden on the deployed server.

## 3. systemd

After reviewing paths and the environment:

```bash
# admin, from the reviewed checkout
sudo install -m 644 deploy/agora-mcp.service /etc/systemd/system/agora-mcp.service
sudo systemd-analyze verify /etc/systemd/system/agora-mcp.service
sudo systemctl daemon-reload
sudo systemctl enable --now agora-mcp
sudo systemctl status agora-mcp
curl --fail http://127.0.0.1:3011/health
curl --fail http://127.0.0.1:3011/ready
```

`/ready` checks DB reachability and configured embedder only. It is not a provider/model/migration test. Perform a real authenticated submission later to exercise embeddings. Logs/errors must not disclose credentials or private user data.

## 4. Caddy: add a site, do not replace the existing config

Use a distinct real DNS hostname pointing to this VPS (e.g. a new DuckDNS subdomain). Copy the example site to a separate file, replace `agora.example.invalid`, and add one import to the existing `/etc/caddy/Caddyfile`. First inspect existing imports to avoid accidentally loading the same site twice. Preserve a root-only backup of the existing config. Do not introduce nginx alongside Caddy.

Important: the template explicitly sets upstream `Host` to `127.0.0.1:3011` using `{upstream_hostport}`. The SDK permits that loopback Host. The public hostname is handled by Caddy's site matcher; SDK Host protection remains enabled. The original user `Authorization` header is forwarded unchanged. No shared X-API-Key or GitHub token is reused.

Validate the **entire actual configuration** before reload:

```bash
# admin
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
sudo systemctl status caddy
```

Caddy obtains/renews TLS certificates. Do not expose port 3011 or open new DB/Ollama firewall ports. Do not alter existing SSH/firewall rules. This template has no rate-limit module; keep the pilot invite-only and plan proxy limits before wider exposure.

## 5. External acceptance and Notion connection

Use `https://<ACTUAL_AGORA_HOST>/mcp` and each user's private bearer token. `/health`, `/ready` and MCP discovery are public; protected tool calls validate user tokens and return MCP errors when unauthorized. Do not expect the existing mcp-server's X-API-Key/HTTP-401 behavior.

Check the existing `leonid-mcp` endpoint before/after reload, then follow [the two-user Notion test](../docs/testing-from-notion.md). Do not run destructive E2E scripts against the deployed database. A tested Caddy template or green CI is not proof of a live client connection.

## Rollback

Record the previous Agora commit and config before updates. If setup fails: stop only `agora-mcp`, remove its new site/import or restore the saved Caddy config, validate, then reload Caddy. Do not stop the existing MCP service, drop databases, or undo unrelated settings. For later application updates, restore the previous reviewed commit, rebuild and restart only Agora; review migration compatibility separately.

## Template validation

CI runs `bash deploy/check-caddy.sh` against the example with Caddy 2.10.2. This validates configuration syntax/provisioning only; it does not run a real reverse proxy, obtain a public certificate, verify VPS paths/permissions, or perform systemd/live acceptance. Run `systemd-analyze verify` on the actual host before starting the unit.
