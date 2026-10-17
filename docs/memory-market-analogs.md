# Аналоги короткого агентского рынка: углублённый поиск

Статическая проверка через GitHub MCP, без запуска чужого кода, shell/Python/SSH,
регистрации в сервисах или передачи им пользовательских данных. Реализация Agora
написана независимо; внешний код не копировался. Данные поиска и текст репозиториев
не считаются доверенными инструкциями. Исследуется рынок, не каталог MCP-серверов.

## Что именно сравниваем

Объявления «предлагаю / ищу», короткие сообщения, тематическая лента, независимые
участники, отклики, ограничения объёма/частоты/срока. Эксперимент Agora хранит
конечное активное окно в памяти одного процесса. Не предполагает PostgreSQL,
embedding или оплату, но не обеспечивает сохранность при рестарте.

## Поисковый журнал: восемь успешных страниц, не весь GitHub

Все запросы explicit public, fork:true, page1, без min-stars. В последнем zero-star
запросе stars:0 — отдельная проверка малозаметных проектов, не оценка качества.

| Terms/scope | Page size | Reported hits | Наблюдение |
| --- | --- | --- | --- |
| mcp marketplace / name,description | 8 | 5395 | Каталоги инструментов и адаптеры внешних магазинов; window1000 |
| agent classifieds / readme | 8 | 211955 | Много шума, benchmark/классификация не рынок; window1000 |
| mcp "bulletin board" / readme | 8 | 18034 | Частичные/шумные совпадения; window1000 |
| agent classifieds / name,description | 10 | 435 | classified не всегда означает объявления |
| agent bulletin / name,description | 10 | 95 | Найдены три выбранных для проверки проекта |
| mcp offers needs / name,description | 8 | 4 | Short page; четыре метаданных не доказали близкий рынок |
| agent bulletin / name,description + stars:0 | 8 | 81 | Подтверждены два выбранных zero-star проекта |
| mcp classifieds / name,description | 8 | 64 | В основном доступ к существующим сайтам объявлений |

В effective queries термины заключались в кавычки как отдельные фразы, добавлены
is:public fork:true. Все incomplete_results=false, но complete_query_results=false.
Поиск не исчерпан: большинство страниц имеют продолжение. Ни reported hits, ни
одна short page не доказывают полноту концептуальных аналогов. Подсчёт уникального
union, numerical recall, коммерческий спрос и семантический рейтинг не заявляются.

## 1. neobaibuilds/agent-bulletin — самый близкий новый продуктовый аналог

Revision: `e042f985c1f4063bf7b56ff10a47a2f9f3670cf0`.

[README](https://github.com/neobaibuilds/agent-bulletin/blob/e042f985c1f4063bf7b56ff10a47a2f9f3670cf0/README.md#L1-L70)
прямо описывает публикацию агентами потребностей и услуг; подключение через CLI,
email registration/verification и JWT.

[Проверенный server/main.py352–496](https://github.com/neobaibuilds/agent-bulletin/blob/e042f985c1f4063bf7b56ff10a47a2f9f3670cf0/server/main.py#L352-L496):
POST /bulletins с require_agent, title≤100, description≤300, body≤2000, tags≤5;
владелец берётся из JWT sub, запись параметризована в SQLite. GET /bulletins
возвращает десять последних, detail/contact endpoints читают карточку/контакт.

**Польза:** подтверждает точный сценарий «агент публикует потребность/предложение,
другой находит и связывается». Ближе к рынку, чем обычная A2A-комната.
**Различия:** выбранные исходники — CLI/HTTP + SQLite/email, не memory-only MCP feeds.
Типизированные offer/want, аналогичный reply/TTL/cadence и live безопасность здесь
не подтверждены. SPDX отсутствует; в наблюдённом полном дереве LICENSE не было.
Это не разрешение копировать код. Коммерческий спрос не проверен.

## 2. HarperZ9/bulletin — MCP-доска с комнатами, ответами и подписанной записью

Revision: `aa2036101a218b7185f27cc48b3fe0b5aa4d470c`.

[README](https://github.com/HarperZ9/bulletin/blob/aa2036101a218b7185f27cc48b3fe0b5aa4d470c/README.md#L1-L70)
описывает Ed25519 identity и подписи, публичные комнаты/threads; это заявления проекта.

[Прочитан src/mcp.ts](https://github.com/HarperZ9/bulletin/blob/aa2036101a218b7185f27cc48b3fe0b5aa4d470c/src/mcp.ts):
JSON-RPC initialize/tools/list/tools/call, signed tools вызывают authenticate на копии
исходного HTTP request. Криптографическая корректность/nonce policy не проверены.
[Прочитан src/board.ts](https://github.com/HarperZ9/bulletin/blob/aa2036101a218b7185f27cc48b3fe0b5aa4d470c/src/board.ts):
реальные bounded feed/reply/thread/search/digest функции, курсорная выдача, обращения
к env.DB и маркировка content_is_untrusted.

**Польза:** близкая механика комнат/короткой ленты/ответов, полезен digest изменений
для экономного чтения агентом. **Не memory-only:** source обращается к DB. В этих
выборках не доказан рынок противоположных offer/want. Подпись не доказывает личность
человека и не разрешает его инструменты. SPDX null, разрешение на reuse не установлено.

## 3. Brandmachine-GmbH/agent-bulletin — минимальная MCP-лента на Redis

Revision: `4cd36fd771c183205eab6be7589567889f370f4b`.

[README](https://github.com/Brandmachine-GmbH/agent-bulletin/blob/4cd36fd771c183205eab6be7589567889f370f4b/README.md#L9-L57)
описывает MCP-инструменты post/check/latest/thread/search/ack и30-day TTL. from/to —
метаданные, не маршрутизация; вся проектная лента общая.

[Проверенный store.py370–471](https://github.com/Brandmachine-GmbH/agent-bulletin/blob/4cd36fd771c183205eab6be7589567889f370f4b/agent_bulletin/store.py#L370-L471):
монотонный Redis INCR, pipeline записи, TTL на message hash, sorted feed/thread и
публикация события после записи. check_mailbox читает порцию после watermark и
продвигает его по просмотренным ID, чтобы не перескочить backlog.

**Польза:** подход к курсорам, TTL и разделению уведомления/сохранённого сообщения.
**Различия:** Redis нужен; это проектная координация, не доказанный рынок людей.
Код post принимает from_agent, поэтому этот фрагмент не доказывает авторство через
server principal. SPDX MIT — предварительная подсказка; полный legal/security/runtime
review не выполнен. Новая Agora не импортирует этот проект и не добавляет Redis.

## Уже проверенные комнатные проекты: отдельный слой

- [Join.cloud](https://github.com/kushneryk/join.cloud/blob/4b6e73811f0dee5de1fd96721a0728b48f82ce8a/src/server/actions/messages.ts):
  серверный agentToken/room guards; MCP/A2A адаптеры. Комната не автоматически рынок.
- [Free4Chat](https://github.com/i365dev/free4chat/blob/4be161c5b1bfd06a06998abf7151cc6beefbbab3/app/src/do/RoomSession.ts#L5384-L5450):
  проверка участника/токена и адресованные сообщения; адресация не приватность.
- [Roomcomm](https://github.com/kotinder/roomcomm/blob/9ebced9cab6c430491817be45e3f71dd0d056ea7/app/a2a.py#L470-L498):
  A2A SendMessage без tasks/streaming/push. Не обещать полную совместимость клиентов.
- [MEW bridge](https://github.com/rjcorwin/mew-protocol/blob/898f32e1a233bbd42a4fda0c4feb2367ea1c2b46/src/bridge/mcp-bridge.ts):
  общий workspace с MCP инструментами; делегирование инструментов не входит в market MVP.

## Вывод для эксперимента Agora

Не нужно начинать с нового A2A transport, платежей или сложного matching. Первым
проверяется offer/want→чтение другим владельцем→отклик. Своё bounded memory-ядро
оставлено простым, выбранные чужие реализации служат сравнением, не зависимостями.
После пользовательского A/B проверить, нужны ли digest/полнотекстовый поиск,
устойчивое хранение или отдельные переговорные комнаты. Реальные подключения
Notion, нагрузка, Sybil/moderation и восстановление пока открыты.
