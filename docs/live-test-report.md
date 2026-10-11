# Отчёт живого теста — 2026-10-11

## Что проверено здесь

Среда: текущий HTTPS endpoint `https://leonid-mcp.duckdns.org/agora/mcp`, Notion MCP connection Agora, приложение на reviewed commit `731649bf77122e873be4a300118755bde1721113`, Jina v3 и PostgreSQL. Тексты явно помечены synthetic, не настоящие услуги/заказы. Ни одного токена/пароля в отчёте нет.

| Сценарий | Наблюдение | Результат |
|---|---|---|
| Discovery и auth | 5 инструментов; `get_my_items` → пустой список перед тестом | PASS |
| Submit offer | Тестовое Kotlin/Android предложение, получен UUID | PASS |
| Submit want | Тестовый запрос того же владельца, получен UUID | PASS |
| Listing | Обе карточки, synapse/v0, текст/метаданные/timestamps | PASS |
| Offer-side / want-side search | Оба вернули `{matches:[], items:[]}` при своих взаимно подходящих items | PASS: self exclusion; не межпользовательский поиск |
| Неизвестный valid UUID | `Item not found, inactive, or not yours.` | PASS |
| Пробельный текст | MCP -32602, после trim строка пустая | PASS |
| Deactivate want | `{ok:true}`, запрос исчез из own active listing | PASS |
| Search inactive | Та же безопасная ошибка not found/inactive/not yours | PASS |
| Повторная деактивация | Ошибка, а не ложный `{ok:true}` | PASS |

Полная публикация через MCP подтверждает Jina + DB path, не только отдельный provider probe. Отдельный пользовательский probe ранее вернул 1024 компоненты за 0,92 s; это единичное наблюдение, не latency benchmark/SLA.

## Cleanup и handoff

Тестовый want деактивирован. Одно synthetic offer `[AGORA-LIVE-QA-20261011]` намеренно оставлено для второго чата. Его UUID в текущем handoff: `d36c34e0-bdcf-4538-80ff-14cfcb6c5e4f`. Оно не имеет TTL и должно быть деактивировано владельцем A после теста. Это handoff snapshot, не постоянная seed-запись; если item уже inactive, A публикует новый fixture и передаёт свежий UUID.

## Пока не проверено вживую

- Независимый владелец B, readable candidate match и фактический real-model ranking.
- Запрет B искать/деактивировать item A.
- Удаление B fixture из поиска A и стабильность match_id между двумя live-search.
- Повторная установка на чистом VPS и нагрузки/ANN recall.

Изоляция A/B, upsert и фильтрация деактивированных items покрыты real-Postgres CI с fake embedder. Это другой уровень доказательства; не подменять им live acceptance. Следующий шаг — [параллельный тест](parallel-testing.md) или явный root-run [two-user-smoke.mjs](../deploy/two-user-smoke.mjs). Скрипт делает записи, расходует API-квоту и деактивирует только свои fixtures; **сейчас не запускался на VPS**.
