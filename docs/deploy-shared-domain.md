# Существующий домен, Caddy и маршрут /agora/

## Проверенная конфигурация текущего пилота

Один VPS Ubuntu 24.04 x86_64, около 2 GiB RAM, existing Caddy TLS, старые backend на loopback 3001/3002. Agora отдельная: Unix user agora, database/role agora, isolated Node 22 under /opt/agora-node, service agora-mcp, port 3011. Jina v3 внешняя: не устанавливать тяжёлую локальную модель на эту машину без memory test.

```text
https://leonid-mcp.duckdns.org/agora/mcp → http://127.0.0.1:3011/mcp
https://leonid-mcp.duckdns.org/agora/health → /health
https://leonid-mcp.duckdns.org/agora/ready → /ready
```

Добавленный handle_path стоит перед старой X-Api-Key веткой; её маршруты 3001/3002 сохранены. Prefix /agora удаляется, upstream Host меняется на loopback, Authorization сохраняется. GET /mcp остаётся 405; приложение не знает о внешнем префиксе.

## Автоматический патч — без nano

Сначала application + DB + environment + systemd должны пройти локальные /health и /ready. Запуск **root**, после reviewed checkout:

```bash
python3 /home/agora/agora-mcp/deploy/enable-agora-caddy.py   --domain leonid-mcp.duckdns.org
```

На другом домене передай его plain hostname, не URL. Скрипт не универсальный Caddy editor: поддерживает один явно объявленный site в `/etc/caddy/Caddyfile`, без import/env substitutions, с доступным локальным admin API на 127.0.0.1:2019. При другой структуре/наличии /agora/ останавливается без blind overwrite. Не обходить отказ.

Скрипт:
1. Берёт lock и проверяет running Caddy + local Agora.
2. Сравнивает running HTTP config с adapted on-disk file.
3. Готовит candidate в том же каталоге, не печатает конфиг или ключи.
4. Добавляет ровно handle_path /agora/* → 3011.
5. После исключения новой ветки сверяет semantic AST всего config, включая X-Api-Key и второй HTTP site. Нормализует только group IDs и автоматически скрываемое имя временного Caddyfile.
6. Делает caddy validate, проверяет отсутствие concurrent changes, root-only backup, atomic replace, systemctl reload.
7. Проверяет HTTPS health/readiness и старый unauthenticated /health status.
8. При ошибке восстанавливает exact original file и reload; если файл изменён другим процессом, отказывается clobber rollback и требует администратора.

Нормальная проверка старого /health=401 подтверждает сохранение unauthenticated policy, **не** полноценное функциональное тестирование старого GitHub MCP. После патча отдельно вызови старый MCP через привычное connection.

## Блок конфигурации (для чтения, не замена всего файла)

```caddy
handle_path /agora/* {
    reverse_proxy 127.0.0.1:3011 {
        header_up Host {upstream_hostport}
    }
}
```

Не устанавливать отдельный домен/Caddy, не заменять old X-Api-Key, не проксировать новый endpoint через старую shared-key авторизацию. Public health и readiness доступны. В этой версии репозитория POST /mcp без действительного токена возвращает HTTP 401; объявленный metadata URL находится под /agora/ и проходит через существующий handle_path. Проверки origin-level /.well-known/ требуют отдельных маршрутов из примера Caddy и на уже настроенном VPS автоматически не добавляются. Порты 3011/5432/11434 не открывать в Internet.

## Повторный запуск и rollback

Если endpoint уже работает, script остановится с already exists; не вставляет duplicate block. `caddy validate` failure до atomic replace не меняет активную конфигурацию. Скрипт сохраняет backup path; при ручном rollback восстановить только свою версию, если после неё не было других правок. Никогда не удалять БД и не останавливать старый MCP.

На текущем VPS уже выполнен equivalent reviewed script и HTTPS checks успешны. Не запускать повторно только потому, что runbook обновлён. [Fresh VPS](install-fresh-vps.md), [operations](operations.md).
