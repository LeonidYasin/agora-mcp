# Эксплуатация, секреты и откат

## Три независимых секрета

| Секрет | Где используется | Хранение |
|---|---|---|
| Пароль PostgreSQL agora | DATABASE_URL сервера | root-only /etc/agora-mcp/agora.env |
| Jina API key | Server → embedding provider | тот же EnvironmentFile, не в клиенте |
| Token пользователя Agora | Client → protected tools | private MCP UI; хеш в users.token_hash; выдача через root-only invite files |

Ни один секрет не хранить в git, issue, Pages, чате или shell argv. Не source EnvironmentFile как shell script; systemd читает его сам. Не пересылать stdout cat/EnvironmentFile или полный Caddyfile с X-Api-Key. Scripts с getpass используют local tty; ввод не отображается.

## Статус и диагностика (root)

```bash
systemctl status agora-mcp --no-pager
journalctl -u agora-mcp -n 60 --no-pager
curl --fail http://127.0.0.1:3011/health
curl --fail http://127.0.0.1:3011/ready
curl --fail https://leonid-mcp.duckdns.org/agora/health
```

Ready не проверяет provider, schema или balance. 502 обычно backend, 401 на /agora/health обычно попадание в старую auth ветку, Invalid Host — upstream Host setting, 405 на GET /mcp — нормальный MCP контракт. Embedding errors требуют отдельной проверки API и квоты; не менять модель автоматически.

## Обновление приложения

Issue → PR → CI → review → authorized merge. Затем отдельное разрешённое deployment. Записать предыдущий commit, проверить migration compatibility и backup.

```bash
runuser -u agora -- git -C /home/agora/agora-mcp rev-parse HEAD
runuser -u agora -- git -C /home/agora/agora-mcp fetch origin main
# После ревью заменить placeholder новым immutable SHA.
runuser -u agora -- git -C /home/agora/agora-mcp checkout <REVIEWED_SHA>
runuser -u agora -- env PATH="/opt/agora-node/bin:/usr/local/bin:/usr/bin:/bin"   bash -c 'set -e; cd /home/agora/agora-mcp/mcp-server; npm ci; npm run build; npm test'
# Только после успешной сборки и разрешения:
systemctl restart agora-mcp
```

Helper/docs changes сами по себе не требуют restart runtime. Не git pull в detached HEAD, не upgrade dependencies/npm глобально без issue. EnvironmentFile уже существует — configure-jina.py намеренно не перезаписывает его; изменения секретов проводят privately отдельно с backup/проверкой.

## Backup БД

Под root, перед migrations/изменениями данных:

```bash
install -d -m 700 /root/agora-backups
umask 077
BACKUP="/root/agora-backups/agora-$(date +%Y%m%d-%H%M%S).dump"
runuser -u postgres -- pg_dump -p 5432 -Fc agora > "$BACKUP"
```

Dump содержит публичные тексты, владельцев и token hashes: он тоже чувствителен. Хранить защищённо, добавить off-host копию и проверить restore **в новой отдельной БД**, не поверх live. Raw Jina/token/env secrets не входят автоматически в DB dump; защищённый secret backup — отдельная задача. Регулярный scheduler здесь пока не установлен.

## Отзыв токена

Процесс invite-only: root DB admin может установить token_hash=NULL для конкретного external_id. Сначала точно определить пользователя; не затрагивать других. После отзыва клиент теряет доступ, items не исчезают автоматически. Новый токен выдавать отдельно; не возвращать старый raw token из БД (там его нет).

## Откат

Caddy patch: exact backup, validate, reload только при отсутствии других concurrent edits. Application: предыдущий reviewed commit → rebuild → restart только agora-mcp. Миграции требуют отдельного плана; не удалять данные ради отката. Остановка пилота: `systemctl disable --now agora-mcp`, затем снять только /agora branch, validate/reload Caddy. Старые MCP не останавливать.

## Приватность и бюджет

Внешний API получает item text, вектора и metadata хранятся в Agora. Synthetic/public text only в тестах. На Jina site 2026-10-11 free starter Toy Experiment указан как 10M tokens, non-commercial; пакеты 1B/$50 и 11B/$500. Не считать это вечным бесплатным тарифом: актуальные условия/баланс проверить у провайдера, auto top-up не включать без явного решения. Publish расходует API-квоту; search по stored vectors не вызывает embedding provider.
