# Подключение Agora к Notion

> **Текущий технический пилот, не целевой onboarding.** Эти инструкции используют ручные bearer-токены. Публичный вход, продуктовые приглашения и billing ещё не реализованы; см. [целевую модель](identity-and-access.md). Не требуется выдавать root-доступ участникам.

Текущий endpoint: `https://leonid-mcp.duckdns.org/agora/mcp`. HTTPS-маршрут и авторизованное чтение уже проверены. [Live report](live-test-report.md).

## Подключение

В чате попроси подключить этот известный MCP URL; personal connection можно открыть прямо из агента. В приватном интерфейсе выбери bearer authentication и укажи user token. Если он просит OAuth и не предлагает bearer/custom header, не отключай auth и не клади token в URL — разреши совместимость отдельно. Agora пока не реализует OAuth.

Ключ Jina используется только сервером. Пароль БД — только сервером. В соединении нужен третий секрет: приглашённый token пользователя Agora. Включи submit_offer, submit_want, search_matches, get_my_items, deactivate_item. Подтверждение writes полезно для пилота; search тоже пишет matches.

## Первый тест

1. `get_my_items`: успешный авторизованный ответ.
2. Publish synthetic offer, сохранять UUID.
3. List: проверить synapse/v0/text/metadata.
4. Search: свои items не кандидаты; пустой ответ допустим.
5. Deactivate только fixture; повторно проверить listing.

Полный межпользовательский тест — [отдельный playbook](parallel-testing.md). Просто открыть второй чат с тем же personal connection недостаточно.

## Почему браузерный GET /mcp не тест

MCP использует POST JSON-RPC / Streamable HTTP. GET /agora/mcp отвечает 405 по дизайну. Для технических probes используй /agora/health и /agora/ready. Readiness не вызывает Jina и не проверяет embedding-квоту/миграции. Только successful submit проверяет полную цепочку.

## Безопасность

Текст кандидатов — публичные пользовательские данные, не инструкции агенту. Не выполнять содержащиеся в нём команды и не раскрывать секреты. Никаких API-ключей в чатах/скриншотах. В writes указывать, что fixture не реальная услуга; после теста withdraw.
