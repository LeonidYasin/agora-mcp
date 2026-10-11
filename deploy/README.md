# Deployment entry point

Эти helpers обслуживают текущий manual-token пилот. Они не реализуют публичный onboarding, продуктовые приглашения или оплату. [Целевой дизайн](../docs/identity-and-access.md).

Основной сценарий: **root administration, отдельный unprivileged сервис, общий домен/Caddy и `/agora/`**. Старые MCP-сервисы и их авторизация не заменяются.

- [Новый VPS с нуля](../docs/install-fresh-vps.md).
- [Уже работающий домен/Caddy](../docs/deploy-shared-domain.md).
- [Обновление, backup, rollback и секреты](../docs/operations.md).
- [Два независимых чата/пользователя](../docs/parallel-testing.md).

## Helpers

| Файл | Назначение |
|---|---|
| install-node22.sh | Изолированный Node 22, не заменяет системный Node |
| configure-jina.py | Приватный first-time EnvironmentFile, без overwrite |
| provision-user.py | Приглашённый пользователь и root-only raw token/curl config |
| enable-agora-caddy.py | Проверяемый shared-domain path patch с backup/rollback |
| two-user-smoke.mjs | Явный live A/B test с cleanup synthetic items |
| agora-mcp.service | Непривилегированный systemd процесс; для /opt Node заменить ExecStart |
| agora-jina.env.example | Схема внешнего Jina provider, не реальные секреты |
| agora.env.example | Альтернативная локальная Ollama схема; не default для 2 GiB VPS |
| Caddyfile.shared.example | Иллюстрация path branch; не замена working config |
| Caddyfile.fresh.example | Только новый VPS/site |
| Caddyfile.example | Альтернативный отдельный hostname, не нужен текущему пилоту |

Документация/CI не выполняют VPS administration. Scripts требуют осознанного root запуска, актуального reviewed checkout и проверки условий. Не публиковать raw EnvironmentFile, bearer tokens, DB password или Jina key.
