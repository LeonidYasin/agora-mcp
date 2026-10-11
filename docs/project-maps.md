# Mindmap и граф всех связей проекта

Две разные модели: **mindmap** организует темы; **typed graph** описывает направленные связи и их источники. Это не количественный граф и не доказательство автоматического взаимодействия всех проектов.

## Mindmap

![Mindmap Agora: смысл, MCP, данные, VPS, защита, тесты, документация, развитие](assets/mindmap.svg)

[Редактируемый Mermaid source](assets/mindmap.mmd) · [Graphviz source](assets/mindmap.dot)

## Runtime / deployment

![Runtime: независимые агенты, общий Caddy, Node/systemd, PostgreSQL, внешний Jina и старые MCP](assets/graph-runtime.svg)

Старые backend 3001/3002 размещены рядом; их X-Api-Key не является Agora bearer token. Provider вызывается при publish, не при vector search.

## Данные и wire-format

![Данные: bearer hash, users, items, cosine search, matches и synapse/v0](assets/graph-data.svg)

## Разработка и публикация

![Workflow: issue, branch, PR, CI, protected main, Pages и separately authorized VPS deployment](assets/graph-workflow.svg)

Pages build не запускает приложение и не выполняет SSH/deploy на VPS.

## Экосистема

![Ecosystem: NoKing, Civis, synapse, synapse2, mcp-server и реализованный subset протокола Agora](assets/graph-ecosystem.svg)

Пунктир — conceptual связь. Канонический protocol находится в mcp-server; копия в Agora. Описанные profile/contact/exchange не становятся доступными инструментами от наличия документа. Никакого auto sync, federation или A2A в runtime пока нет.

## Полный граф, не только overview

[JSON nodes/edges с типами и source](assets/project-graph.json) · [Полный editable DOT](assets/project-full.dot).

Полный dataset включает repository inventory, все относительные TypeScript imports и разрешаемые локальные Markdown links, runtime/schema/deployment/test workflow и явно ограниченные ecosystem relations. Не объявляет несуществующие интеграции. Generated SVG — читаемые выборки; HTML-сайт дополнительно показывает всю таблицу отношений с поиском и source links, включая file dependencies.

Regenerate: `python3 site/generate-maps.py` (Graphviz dot). Build проверяет ссылки и покрытие файлов/TS dependencies. Добавление source file или import требует регенерации; не править JSON/SVG раздельно.
