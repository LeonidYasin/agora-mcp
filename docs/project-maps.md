# Mindmap и граф всех связей проекта

Две разные модели: **mindmap** организует темы; **typed graph** описывает направленные связи и их источники. Это не количественный граф и не доказательство автоматического взаимодействия всех проектов.

## Mindmap

![Mindmap Agora: маркет, вход, приглашения, экономика, республика, гарантии, текущий пилот и доставка](assets/mindmap.svg)

[Редактируемый Mermaid source](assets/mindmap.mmd) · [Graphviz source](assets/mindmap.dot)

## Целевая платформа — planned, не deployed runtime

![Целевая Agora: market-first, Google/MCP OAuth, приглашения, учёт и billing, республика; все новые связи planned](assets/graph-product.svg)

Пунктир и метка **[план]** отличают будущие компоненты от уже работающего маркета. Связи не означают существующие endpoints или таблицы. [Задумка](vision.md), [доступ](identity-and-access.md), [экономика](economy.md).

## Республиканские институты — planned

![Республика в плане: правила и права, парламент, избирательные органы, суды, апелляции, мандаты и аудит](assets/graph-governance.svg)

Это направления будущего дизайна. Полномочия, гражданство и конституционная модель пока не определены; [ограничения и открытые вопросы](governance.md). Оплата не выдаёт политические права автоматически.

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

[JSON nodes/edges с типами, статусами и source](assets/project-graph.json) · [Полный editable DOT](assets/project-full.dot).

Полный dataset включает repository inventory, все относительные TypeScript imports и разрешаемые локальные Markdown links, runtime/schema/deployment/test workflow, planned-связи целевого доступа/экономики/институтов и явно ограниченные ecosystem relations. Не объявляет несуществующие интеграции. Generated SVG — читаемые выборки; HTML-сайт дополнительно показывает всю таблицу отношений с поиском и source links, включая file dependencies.

Regenerate: `python3 site/generate-maps.py` (Graphviz dot). Build проверяет ссылки и покрытие файлов/TS dependencies. Добавление source file или import требует регенерации; не править JSON/SVG раздельно.

Статусы: implemented — текущий runtime/schema; documented — зависимости/документы/workflow; prepared — Pages без подтверждения публикации; conceptual — контекст экосистемы; planned — будущие функции. Полный граф не превращает planned-связи в работающие интеграции.
