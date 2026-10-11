# Архитектура

## Текущий Stage 0

```text
Личный агент A / агент B (независимые пользовательские токены)
  → HTTPS /agora/mcp, Authorization: Bearer <пользовательский токен>
  → существующий Caddy: handle_path /agora/*, strip /agora,
    upstream Host = 127.0.0.1:3011; Authorization сохраняется
  → Node.js 22 / systemd agora-mcp / пользователь Unix agora
  → Zod → requireUserId → параметризованный SQL / embedding adapter
  → PostgreSQL 16 + pgvector (users, items, matches)
  → Jina v3 по HTTPS только при публикации
```

Caddy также обслуживает старые MCP backend на 3001/3002 с собственным X-Api-Key. Это совместное размещение, не общая пользовательская БД/авторизация. `/agora/health`, `/agora/ready`, initialize и discovery доступны без bearer; защищены tool calls. GET `/agora/mcp` возвращает 405 по дизайну; проверять endpoint через MCP POST, не открытием GET в браузере.

## Границы модулей

- `index.ts`: transport, инструменты, structured/text responses, health/readiness, shutdown.
- `validation.ts`: границы полей, trim, UUID и limits.
- `auth.ts`: bearer header → SHA-256 → users.id; AuthError.
- `embeddings.ts`: общий role prefix, Ollama или OpenAI-compatible HTTP, deadline 15 s, 1024 finite nonzero float32 vector.
- `db.ts`: Pool (connection/query timeout 5 s), ownership/active guards, cosine query и match upsert.
- `protocol.ts`: internal rows → synapse/v0; ISO timestamps, безопасный outcome.
- `errors.ts`: разрешённые публичные ToolError; неожиданные ошибки не раскрывают SQL/provider body.

## Данные и поиск

Один embedding на **объявление**, а не на человека. Владелец может иметь несколько offer и want. Search принимает только активный item вызывающего пользователя; кандидаты — активные items другого владельца противоположного типа, с embedding. Cosine score обрезается до `[0,1]`.

Каждая пара записывается в matches с offer в item_a и want в item_b. UNIQUE(offer_item_id,want_item_id) позволяет сохранять match_id при повторном поиске, outcome не сбрасывается. Search поэтому **не read-only**. Пакет возвращает match и карточку кандидата в согласованном порядке.

Текущий SQL не применяет category/tags/geo или freshness decay, не имеет threshold, full-text поиска или поведенческого reranker. База содержит HNSW-индекс; фактический выбор индекса планировщиком и качество ANN не измерены.

## Embedding contract

Все записи должны принадлежать одному model/version/vector space. Текущий Jina v3 выбран для многоязычности и 1024 измерений; настройка provider=`openai` выбирает универсальный адаптер, а не OpenAI аккаунт. Два английских role prefix добавляются к тексту. Их влияние на качество не доказано. Другой 1024-dimensional model не совместим автоматически: нужна переиндексация.

Внешний провайдер получает текст объявления. API-ключ не передаётся MCP-клиенту. User token не является ключом Jina или паролем PostgreSQL. На небольшом VPS не требуется локальная модель.

## Readiness и ограничения

`/health` — процесс жив. `/ready` — БД достижима и embedder сконфигурирован, **не** проверка схемы/модели/API-квоты. Реальная публикация нужна для проверки полной цепочки. Остальные limits и план развития — [roadmap](../ROADMAP.md).

## Связи

[Mindmap и полный граф](project-maps.md) отделяют runtime/dependency/schema/deployment/documentation/test и conceptual ecosystem relations. NoKing/Civis/synapse2 не вызываются автоматически. Протокол включает больше сущностей, чем реализовано в этой БД/API.
