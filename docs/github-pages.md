# GitHub Pages: документация, не MCP-хостинг

Ранее в main не было сайта, mindmap/графа или Pages workflow; этот пакет создаёт их впервые. URL после включения и успешного deployment: `https://leonidyasin.github.io/agora-mcp/`. До этого не заявлять, что сайт опубликован.

## Единый источник

Markdown в repo → Node static builder → `_site/`. Mindmap/typed graph берут source-of-truth JSON. Нет отдельных вручную расходящихся копий инструкций, runtime credentials или browser API calls. Pages — только статическая документация; MCP остаётся на VPS.

## Локальная сборка

```bash
cd site
npm ci
npm run build
npm test
```

Открыть `_site/index.html` либо локальный static server. Относительные ссылки рассчитаны на project Pages path, не на корень username.github.io. Helper scripts скачиваются через downloads и имеют checksum manifest. README/ROADMAP и установка доступны в HTML.

## Активация и публикация

1. Reviewed PR должен быть merged в main; не обходить branch protection.
2. Repository Settings → Pages → Build and deployment → Source: **GitHub Actions**. Администратор делает настройку, если ещё не включено.
3. Workflow `Documentation Pages` на push main/manual строит site, проверяет ссылки, загружает artifact и deploy-pages. Только deployment job имеет pages:write/id-token:write; no VPS credentials.
4. При первом использовании environment `github-pages` может требовать approval согласно правилам repo. Не снимать protection ради удобства.
5. Проверить successful deployment job и живой URL; наличие workflow или artifact не равно публикации. Если configure-pages сообщает Pages disabled, выполнить шаг 2 и запустить workflow снова.

PR CI всегда проверяет docs build, но не публикует непроверенную ветку. Пока PR открыт/Pages не активирован, использовать локальный preview или приложенный ZIP сайта. Это не опубликованный GitHub Pages.

## Обновление схем

`python3 site/generate-maps.py` (нужен Graphviz dot) пересоздаёт data/SVG/DOT/Mermaid из runtime inventory и исходников. Диаграммы репозитория и доступные исходники не имеют секретов. Проверить визуально desktop/mobile и link audit; maps distinguish current, CI-only, pending and conceptual relations. Большой граф имеет readable grouped views и text edge table, а не одну нечитаемую картинку.
