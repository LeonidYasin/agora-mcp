# Параллельный тест из другого чата

## Главное: разные чаты ≠ разные пользователи

Автором item является владелец bearer-токена, не диалог или модель. Два чата с токеном A публикуют items одного владельца и **не будут матчиться друг с другом**. Понадобится отдельный token B и независимое MCP-подключение.

Если клиент не позволяет хранить два соединения к одному URL с разными credentials, используй другой аккаунт/клиент, поддерживающий bearer header. Не меняй общий токен A на B вслепую: это может переключить оба чата. Не обходи ограничение клиентского UI непроверенными URL-алиасами.

## 1. Provision B на VPS

Под root, из reviewed checkout, содержащего эти scripts:

```bash
python3 /home/agora/agora-mcp/deploy/provision-user.py   --external-id agora-test-b   --display-name 'Agora Test B'
```

Скрипт откажется перезаписывать существующего пользователя/файлы. Хранит только хеш в users, raw token в `/root/agora-invites/agora-test-b.token` (0600, directory 0700). Ключи не выводятся. Если ты ещё на старом deployed commit, сначала возьми скрипт из reviewed PR/прикреплённого файла; не делай git pull/restart сервиса только ради тестового helper.

Посмотреть токен только локально:

```bash
less /root/agora-invites/agora-test-b.token
```

Не отправляй токен в чат, issue или public docs. Это не ключ Jina и не пароль БД.

## 2. Подключение B

URL: `https://leonid-mcp.duckdns.org/agora/mcp`. Тип: Streamable HTTP; bearer token B; `Authorization` передаётся как есть. В Notion попроси создать независимое MCP connection «Agora B» и выбери его инструменты в другом чате. Доступность двух personal connections к одному URL определяется клиентом; если UI переиспользует старое соединение, выбери другой поддерживаемый аккаунт/клиент.

Разреши 5 инструментов и подтверждение writes. Прежде чем публиковать, вызови `get_my_items`: у нового B список должен быть пустым. Если видишь synthetic offer A, остановись: используется не тот токен.

## 3. Prompt для чата B

```text
Используй только независимое MCP-подключение Agora B с токеном пользователя B.
Не переключай credentials других соединений и не проси ключи в чате.
1. Выполни get_my_items; если видишь fixture пользователя A, остановись.
2. Опубликуй submit_want:
   text: "[AGORA-PARALLEL-QA] Тест, не реальный заказ: нужна помощь с Kotlin и Android онлайн."
   category: "it", tags: ["agora-parallel-qa", "kotlin", "android"], geo: "online".
3. Сохрани возвращённый item_id B и выполни search_matches(item_id B, limit 50).
4. Найди тестовое Kotlin/Android offer A по переданному UUID или метке.
   Покажи его текст, score, match_id и owner_a != owner_b; score не является вероятностью сделки.
5. Попробуй search_matches и deactivate_item для UUID A: оба должны вернуть ошибку.
   Это явно разрешённый отрицательный тест synthetic fixture.
6. Не деактивируй свой want до обратного поиска A. Передай в первый чат
   только UUID B и match_id, не токен.
```

Первый чат получает UUID B и повторяет поиск по своему offer A. Он должен найти want B. Повторный поиск должен сохранить match_id той же offer/want пары.

## 4. Очистка

После обоих поисков B деактивирует **свой** want; A повторяет поиск и убеждается, что карточка B отсутствует. Затем A деактивирует **своё** тестовое offer. Проверить own listing обоих участников. Не деактивировать посторонние записи. Деактивация не удаляет items/matches из БД и не меняет outcome на exchanged.

## Альтернатива без второго UI

Provision `agora-test-a` и `agora-test-b` (если A уже есть — не создавать повторно). Под root:

```bash
/opt/agora-node/bin/node   /home/agora/agora-mcp/deploy/two-user-smoke.mjs   https://leonid-mcp.duckdns.org/agora/mcp
```

Это opt-in live test, не read-only: создаёт synthetic items, расходует embedding-квоту и сохраняет matches. Проверяет independent users, self exclusion, candidate cards, small-fixture ranking, stable upsert, ownership, withdrawal. В finally деактивирует созданные им items; при ошибке cleanup выводит только UUID для владельца. Перед запуском библиотеки должны быть установлены `npm ci` в mcp-server. Скрипт ещё не запускался на текущем VPS; отчёт не заявляет его успех.
