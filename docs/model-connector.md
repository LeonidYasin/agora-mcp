# Сменяемые LLM и embedding API на существующем VPS

## Решение и границы

Issue #16: платные API допустимы. Существующий VPS, PostgreSQL/pgvector и MCP
остаются; не требуется Cloudflare или перенос продукта. Agora использует единый
OpenAI-compatible HTTP-контракт. Провайдеры с другим нативным API подключаются
через готовый gateway, например LiteLLM, **не через собственный набор SDK**.

[LiteLLM gateway](https://docs.litellm.ai/docs/simple_proxy) переводит провайдеров
в OpenAI-compatible API; [описание endpoints](https://docs.litellm.ai/docs/providers/litellm_proxy)
включает embeddings и chat/completions. Это основание выбора интерфейса, не
подтверждение совместимости каждого поставщика/модели. LiteLLM здесь не установлен,
не добавлен как обязательная зависимость и не запущен. Версию и лицензию выбранного
пакета нужно проверить отдельно до установки; enterprise-функции не предполагаются.

### Две разные возможности

- **Embeddings**: текст → вектор для поиска. Нужна embedding-модель.
- **Chat**: сообщения → текст. Нужна chat-модель; она не обязана поддерживать embeddings.

URL, model alias и ключ могут быть разными для этих задач. Можно подключать
оплачиваемые сервисы, локальные сервисы или общий gateway с двумя model aliases.
«Универсальный» означает сменяемый совместимый backend, **не любую модель без
ограничений и не автоматическую поддержку всех API-функций**.

## Что реализовано в этой ветке

`src/model-gateway.ts`: ограниченный HTTP transport и опциональный text chat.
`src/embeddings.ts`: старый OpenAI-compatible embedding adapter использует общий
transport; нативный Ollama сохранён. provider aliases: `openai` (legacy),
`openai-compatible`, `litellm`. Последние два требуют явный BASE_URL; нет скрытого
выбора платного OpenAI endpoint. Старый Jina-конфиг с root URL продолжает указывать
на `/v1/embeddings`.

Root BASE_URL получает `/v1`. Непустой path считается полным API prefix:
`https://provider.example/v1` или `https://gateway.example/proxy/v1`.
Trailing slash убирается; `/v1/v1` не добавляется. Для нестандартного API prefix
указать его явно. URL/ключи задаёт администратор; MCP-пользователь их не выбирает.

Общий transport: deadline 15 s по умолчанию, ответ до 1 MiB, HTTPS либо loopback
HTTP, без URL credentials/query/fragment, redirects запрещены. Сырые provider
errors/ключи не возвращаются. Один запрос, без автоматического retry или fallback
на другого поставщика. Это снижает риск неожиданных повторных расходов, **не**
заменяет бюджеты, rate limits или политику логирования у внешнего gateway.
Нативный Ollama остаётся прежним отдельным адаптером; новые HTTP-ограничения
относятся к общему OpenAI-compatible transport, не ко всем старым провайдерам.

Опциональный `createChatService()` ничего не вызывает при создании и возвращает
null без LLM_PROVIDER. Chat не подключён к MCP tools автоматически. Поддерживается
только non-stream текст, роли system/user/assistant, до 100 сообщений и 64000
UTF-16 code units суммарно. Обязательный output cap 1..8192 tokens; поле
`max_tokens` либо `max_completion_tokens` задаётся в конфигурации. Unsupported
parameter/model errors возвращаются как ошибка, не меняют модель молча.
Нет tools, vision, audio, Responses API, streaming или автономных действий.
Результат модели — недоверенные данные, не разрешение исполнять команды.

## Конфигурация без реальных ключей

`deploy/model-connector.env.example` — пример дополнения к EnvironmentFile,
не команда и не автоматически применяемый файл. Chat и embeddings имеют разные
настройки. Gateway может потребовать виртуальный ключ; ключи поставщиков можно
оставлять в самом gateway. Endpoint без авторизации допускается низкоуровневым
классом, но env-фабрики требуют ключ (для доверенного локального endpoint при
необходимости используется явно настроенное фиктивное значение).

Нельзя смешивать старые и новые embeddings: действующая БД и validator требуют
**1024** измерения. Для другой размерности нужна новая миграция, а для другой
модели/версии — безопасная переиндексация, даже при тех же 1024. Изменение MODEL
в env само по себе такой переход не обеспечивает. Автоматический fallback между
embedding-моделями запрещён. Applied migrations не редактировать.

## Проверки и эксплуатация

Тесты с fake HTTP providers в GitHub CI покрывают URL/prefix, chat/embedding модели,
ключи, token cap, validation, redirect, quota error, deadline и bounded body.
Это contract tests, **не** реальный запрос к Jina/OpenAI/Anthropic/LiteLLM, не
измерение качества или стоимости. Платные вызовы, новые аккаунты и установка
gateway не выполнялись. Live budget/retries/log retention надо настраивать отдельно.

Не читать реальные EnvironmentFile и не печатать ключи. Любое выполнение/установка
на VPS требует отдельного согласия и специального подтверждения владельца.
Изменения API/модели/мigrations и deployment не следуют автоматически из CI.
