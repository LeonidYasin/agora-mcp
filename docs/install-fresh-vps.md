# Установка заново на новый VPS

Пошаговый runbook для **нового Ubuntu 24.04 x86_64/arm64 VPS с root-доступом**. Ручного nano-редактирования рабочих секретов/маршрутов не требуется. Все команды ниже на VPS под root, кроме обозначенных local-команд. Это инструкция, **не отчёт об уже проверенной второй установке**.

Для уже работающего сервера используй [shared-domain runbook](deploy-shared-domain.md), не fresh replacement. Docker нужен CI, не VPS. Локальная модель не нужна: Jina API выполняет embeddings. Пилот работает на VPS около 2 GiB RAM, но это не гарантия нагрузки или минимальной конфигурации.

## 0. Подготовить доступ, DNS и бюджет

Нужны root SSH, выбранный DNS hostname, исходящий HTTPS к GitHub/Node/PGDG/Jina, входящие 80/443 и существующий SSH-порт. Открытыми наружу НЕ должны быть application 3011, Postgres 5432, Caddy admin 2019, Ollama 11434.

На своём компьютере:

```bash
ssh root@<VPS_IP>
```

На VPS:

```bash
whoami
cat /etc/os-release
uname -m
free -h
df -h /
ss -lntp
```

Если неожиданно уже есть сервисы/БД — не перезаписывать, перейти к shared-domain процедуре. Не выполнять reboot/apt upgrade/autoremove автоматически. Kernel reboot планировать отдельно с проверкой автозапуска других сервисов. Если hostname уже обслуживает старый VPS с другими приложениями, переключение DNS перенесёт **весь домен**: сначала подготовить все нужные сервисы, не терять старый MCP при cutover.

Jina key получить в [API KEY & BILLING](https://jina.ai/embeddings/): auto-generated new-user key, Available tokens, Toy Experiment. На 2026-10-11 стартовый пакет 10M tokens помечен non-commercial. Не обещать постоянную бесплатную квоту, не включать auto top-up. API получает публичный item text. Все реальные credentials хранить вне repo/chat.

## 1. Системные утилиты, пользователь и reviewed checkout

```bash
apt update
apt install -y curl ca-certificates xz-utils git python3
```

Проверь `id agora`; если пользователь отсутствует:

```bash
adduser --disabled-password --gecos "" agora
```

Не добавлять agora в sudo. Если каталог уже существует, остановиться — не clone поверх.

```bash
runuser -u agora -- git clone https://github.com/LeonidYasin/agora-mcp.git /home/agora/agora-mcp
```

На GitHub выбери **reviewed merged commit**, содержащий эти helpers; скопируй полный SHA и замени placeholder. Устанавливать произвольную непроверенную PR-ветку не нужно.

```bash
REVIEWED_SHA='<FULL_REVIEWED_MERGED_SHA>'
runuser -u agora -- git -C /home/agora/agora-mcp checkout "$REVIEWED_SHA"
runuser -u agora -- git -C /home/agora/agora-mcp rev-parse HEAD
```

Detached HEAD нормален — это pinned deployment, не ошибка.

## 2. Изолированный Node 22

```bash
bash /home/agora/agora-mcp/deploy/install-node22.sh
```

Скрипт выбирает архитектуру, HTTPS-download официального latest-v22 archive, checksum из SHASUMS, /opt/agora-node. Не заменяет системный Node. Если Node 22 там уже есть — оставляет его, не обновляет. Несовместимый existing path вызывает отказ. Зафиксируй выведенные версии; checksum — проверка integrity загрузки, не обещание неизменного latest release.

```bash
runuser -u agora -- env PATH="/opt/agora-node/bin:/usr/local/bin:/usr/bin:/bin"   bash -c 'set -e; cd /home/agora/agora-mcp/mcp-server; npm ci; npm run build; npm test'
```

Ожидаются успешная сборка и 8 unit tests. npm предлагает major update — не выполнять без отдельной задачи.

## 3. PostgreSQL 16 и pgvector

Сначала проверить отсутствие установленного кластера:

```bash
dpkg -l | awk '$1 == "ii" && $2 ~ /^postgresql/ {print $2, $3}'
command -v pg_lsclusters >/dev/null && pg_lsclusters
ss -lntp '( sport = :5432 )'
```

Если PostgreSQL уже найден, остановись: нужны его версия/порт, а не второй cluster. Для действительно новой установки выполняй последовательно (PGDG script может спросить Enter):

```bash
apt install -y postgresql-common
/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh
apt update
apt install -y postgresql-16 postgresql-16-pgvector
pg_lsclusters
runuser -u postgres -- psql -p 5432 -Atqc 'SELECT version();'
```

Ожидаемый cluster 16/main online, port 5432. Проверить `SHOW listen_addresses`; стандартный localhost оставить, public firewall port не открывать.

```bash
runuser -u postgres -- psql -p 5432 -Atqc 'SHOW listen_addresses;'
runuser -u postgres -- psql -p 5432 -Atqc "SELECT rolname FROM pg_roles WHERE rolname = 'agora';"
runuser -u postgres -- psql -p 5432 -Atqc "SELECT datname FROM pg_database WHERE datname = 'agora';"
```

Если роль/БД уже существуют, не заменять. Для новых:

```bash
runuser -u postgres -- createuser -p 5432 --no-superuser --no-createdb --no-createrole --pwprompt agora
runuser -u postgres -- createdb -p 5432 -O agora agora
runuser -u postgres -- psql -p 5432 -d agora -v ON_ERROR_STOP=1   -c 'CREATE EXTENSION IF NOT EXISTS vector;'   -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto;'
```

Пароль вводится дважды скрыто; сохранить privately. vector требует DB-admin, поэтому enable отдельно. Применить migrations под limited role (TCP + password prompt, не root DB role):

```bash
psql -h 127.0.0.1 -p 5432 -U agora -d agora -W -v ON_ERROR_STOP=1   -f /home/agora/agora-mcp/db/migrations/001_init.sql   -f /home/agora/agora-mcp/db/migrations/002_auth_and_protocol_alignment.sql
psql -h 127.0.0.1 -p 5432 -U agora -d agora -W -c '\dt'
```

Ожидаются users/items/matches. NOTICE extension exists — нормально. Миграции не являются повторно запускаемыми целиком: не повторять их после успеха. Не E2E TRUNCATE на live DB.

## 4. Приватная конфигурация Jina

```bash
python3 /home/agora/agora-mcp/deploy/configure-jina.py
```

В local tty скрыто ввести DB password и Jina key. Helper создаёт `/etc/agora-mcp` 0700 и agora.env 0600, URL-encodes DB password, не выводит secrets, не перезаписывает existing config. Поля: NODE_ENV=production, HOST=127.0.0.1, PORT=3011, DATABASE_URL, EMBEDDING_PROVIDER=openai, BASE_URL=https://api.jina.ai, MODEL=jina-embeddings-v3, API_KEY. `openai` означает адаптер, не vendor. `/v1/embeddings` добавляется кодом, в BASE_URL его не повторять.

Код ожидает 1024 finite nonzero float32 vector. Другую модель не подставлять автоматически. External provider может менять quota/доступность; full publication test ниже проверяет actual path.

## 5. systemd

```bash
ss -lntp '( sport = :3011 )'
```

Если port занят — остановиться. Иначе:

```bash
install -m 644 /home/agora/agora-mcp/deploy/agora-mcp.service /etc/systemd/system/agora-mcp.service
sed -i 's|^ExecStart=.*$|ExecStart=/opt/agora-node/bin/node dist/index.js|' /etc/systemd/system/agora-mcp.service
systemd-analyze verify /etc/systemd/system/agora-mcp.service
systemctl daemon-reload
systemctl enable --now agora-mcp
systemctl status agora-mcp --no-pager
curl --fail http://127.0.0.1:3011/health
curl --fail http://127.0.0.1:3011/ready
```

Process runs as agora without sudo; root systemd reads private EnvironmentFile. Ready=database reachable + provider configured, не live provider/schema test. Failure: `journalctl -u agora-mcp -n 60 --no-pager`, проверить secrets перед пересылкой.

## 6. Caddy: выбрать один вариант

### Вариант A — Caddy/домен уже работают

Не выполнять fresh replacement ниже. Только reviewed safe patch:

```bash
DOMAIN='<EXISTING_HOSTNAME>'
python3 /home/agora/agora-mcp/deploy/enable-agora-caddy.py --domain "$DOMAIN"
```

Он требует local admin API, прямой site без imports/env substitutions, local Agora и соответствует ограниченному проверенному типу конфигурации. При отказе не отключать safeguards. [Подробности](deploy-shared-domain.md).

### Вариант B — новый VPS, нового working Caddy config ещё нет

Используй уже выбранный hostname; отдельный домен на каждый сервис не требуется. DNS должен указывать на **этот** VPS, 80/443 свободны/доступны. Если используешь старый shared hostname, сначала учти cutover всех его сервисов.

Официальная apt установка Caddy; не выполнять, если existing installation нужно сохранить:

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key   | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt   > /etc/apt/sources.list.d/caddy-stable.list
apt update
apt install -y caddy
```

Пример hostname ниже — заменить реальным. Helper создаёт candidate, валидирует, сохраняет старый stock config и атомарно устанавливает новый. **Он предназначен только для выбранного fresh сценария**, не умеет сохранять произвольные чужие routes.

```bash
DOMAIN='<YOUR_REAL_HOSTNAME>'
getent ahostsv4 "$DOMAIN"
python3 - "$DOMAIN" <<'PYINSTALL'
import grp
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
host = sys.argv[1].lower()
if not re.fullmatch(r'[a-z0-9.-]+', host) or '.' not in host:
    sys.exit('Use a real plain DNS hostname.')
config = Path('/etc/caddy/Caddyfile')
template = Path('/home/agora/agora-mcp/deploy/Caddyfile.fresh.example').read_text()
fd, name = tempfile.mkstemp(prefix='.agora-fresh-', dir=config.parent)
candidate = Path(name)
try:
    with os.fdopen(fd, 'w') as file:
        file.write(template.replace('agora.example.invalid', host))
    result = subprocess.run(['caddy', 'validate', '--config', str(candidate), '--adapter', 'caddyfile'], capture_output=True)
    if result.returncode:
        sys.exit('Candidate invalid; existing config unchanged. Details hidden.')
    if config.exists():
        backup = config.with_name('Caddyfile.before-fresh-agora.' + time.strftime('%Y%m%d-%H%M%S'))
        bfd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(bfd, 'wb') as file:
            file.write(config.read_bytes())
        print('Backup:', backup)
    os.chown(candidate, 0, grp.getgrnam('caddy').gr_gid)
    os.chmod(candidate, 0o640)
    os.replace(candidate, config)
finally:
    candidate.unlink(missing_ok=True)
PYINSTALL
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl reload caddy
systemctl status caddy --no-pager
```

При validation failure не reload. Для fresh code failure после replacement восстановить сохранённый stock config и validate/reload; shared patch имеет отдельный автоматический rollback. Caddy получает/продлевает certificate автоматически. Никакого nginx рядом.

## 7. Проверка HTTPS и MCP

```bash
curl --fail "https://$DOMAIN/agora/health"
curl --fail "https://$DOMAIN/agora/ready"
```

Повторить со своего компьютера. GET /agora/mcp=405 нормален: JSON-RPC POST нужен для tools. Create two invited users только если имена ещё свободны:

```bash
python3 /home/agora/agora-mcp/deploy/provision-user.py --external-id agora-test-a --display-name 'Agora Test A'
python3 /home/agora/agora-mcp/deploy/provision-user.py --external-id agora-test-b --display-name 'Agora Test B'
```

Raw files root-only; stdout не содержит keys. Затем явно разрешённый live test (writes/API quota):

```bash
/opt/agora-node/bin/node /home/agora/agora-mcp/deploy/two-user-smoke.mjs "https://$DOMAIN/agora/mcp"
```

Ожидаемые PASS и cleanup; этот скрипт не очистит старую БД и не тронет чужие fixtures, но оставит inactive rows/matches как историю. При CLEANUP REQUIRED сохранить UUID и withdraw под соответствующим пользователем.

## 8. Подключение из чатов

[Notion guide](testing-from-notion.md), [independent A/B prompt](parallel-testing.md). Credentials=token A/B, не Jina key и не DB password. Discovery 5 tools, get_my_items, synthetic publication, search, cleanup. Один token в двух чатах не создаёт двух owners.

## 9. Установка считается законченной, когда

- systemd active после проверки; Node path/permissions корректны.
- БД schema и limited-role password auth проверены.
- Local и external health/readiness проходят.
- Реальная публикация + независимый A/B match + ownership negatives + withdrawal проходят.
- Existing services сохранены, если это shared deployment.
- Клиент реально подключён, не просто URL открывается.
- Credentials private, test fixtures withdrawn, записаны commit/версии/ограничения.

Новый VPS runbook требует выполнения на второй машине; текущий live report не объявляет этот пункт пройденным. [Backups/update/rollback](operations.md).
