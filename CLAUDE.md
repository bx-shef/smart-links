# SmartLinks

> Last reviewed: 2026-07-26

Bitrix24-приложение «Умные ссылки». Издатель ИП Шевчик И.С. Клиентское (`ssr: false`) Nuxt 4-
приложение, которое собирается в статику и загружается в портал **архивом** (локальное/маркет-
приложение). Весь код исполняется **внутри iframe портала** (`@bitrix24/b24jssdk` → `B24Frame`);
своего сервера/БД нет — состояние живёт в опциях приложения на портале (`app.option.*`), обмен в
реальном времени — через pull.

**Суть:** приложение регистрирует пользовательский тип поля `SmartLink`; в карточке CRM это поле
рендерится плейсментом и работает как «умная ссылка» на связанную сущность (CRM или элемент
Списка) — поиск, привязка, создание, открытие, отвязка. Полное описание —
[`docs/PROCESS.md`](docs/PROCESS.md); карта проекта и план работ — [`docs/PROJECT_MAP.md`](docs/PROJECT_MAP.md).

## Раскладка

- `app/` — Nuxt (авто-импорт):
  - `pages/` — client-only страницы (`*.html.client.vue` → статические `*.html`): `index`,
    `install`, `handler/uf.smart-link` (обработчик UF-типа), `slider/app-options` (настройки,
    админ, **сейчас заглушка**), `slider/feedback` (обратная связь).
  - `stores/` — Pinia: `appSettings` (версия/статус/`configUfListSettings` + пути + `saveSettings`),
    `link` (текущая целевая ссылка), `page` (title/description/isLoading), `user` (`isAdmin`).
  - `composables/useAppInit.ts` — старт приложения: язык, `initB24Helper` (App/AppOptions/Profile),
    наполнение сторов, `processErrorGlobal`, pull-клиент.
  - `middleware/` — роутинг по `placement.options.place` (слайдеры).
  - `layouts/` / `components/` / `utils/` (чистые функции) / `assets/`.
- `shared/types/base.d.ts` — общие типы (`UfSmartLinkType`, `IStep`).
- `i18n/` — локали (`ru`) + карта локалей.
- `public/` — статика (аватары, favicon, robots).
- `tools/` — оффлайн: `translate.ui.ts` (перевод локалей через DeepSeek), `fix-paths.mjs` +
  `create-archive.mjs` (упаковка архива для B24).
- `template/` — HTML-шаблон загрузчика dev-сервера.
- `server/tsconfig.json` — только типы (полноценного сервера нет).
- `docs/` — документация (см. [`docs/README.md`](docs/README.md)).

**Скоупы приложения:** `user_brief`, `crm`, `list`, `placement`, `userfieldconfig`, `pull`.

## Команды

```bash
pnpm dev          # дев-сервер
pnpm lint         # ESLint
pnpm lint:fix     # ESLint --fix
pnpm typecheck    # nuxt prepare + vue-tsc
pnpm test         # Vitest (unit)
pnpm check        # lint + typecheck + test
pnpm generate     # SSG-сборка в .output/public
pnpm generate-archive-for-b24  # generate → fix-paths → create-archive (архив для портала)
pnpm translate-ui # оффлайн-перевод локалей (нужен DEEPSEEK_API_KEY)
```

## Конвенции

- Комментарии/JSDoc — **английский**; пользовательский текст и документация — **русский**.
- Чистые функции — в `app/utils/*` (с тестами); типы — в `shared/types/*` и рядом с моделью;
  реактивное — в `composables`/`stores`, UI — в компонентах/страницах. Логику из страниц по
  возможности выносим в тестируемые `utils`.
- Данные из API — только через `{{ }}` (auto-escape), без `v-html` с внешними данными.
- Каждый `.md` в корне и `docs/` несёт `> Last reviewed: YYYY-MM-DD` под H1.
- REST-факты Bitrix24 (методы/поля/поведение) проверяем по документации/живому порталу, а не по
  памяти.

## Архитектурные заметки

- **Клиентское приложение внутри портала.** Нет сервера, БД, OAuth-бэкенда. Авторизация — на
  стороне портала; фрейм получает права текущего пользователя (`Profile.isAdmin`). Секретов в
  рантайме нет (кроме публичных `NUXT_PUBLIC_*` формы обратной связи). `DEEPSEEK_API_KEY` нужен
  **только** оффлайн-инструменту перевода, в собранный архив не попадает.
- **Хранилище настроек — опции приложения портала** (`app.option.get/set`), ключ
  `configUfListSettings` (карта `ufCode → UfSmartLinkType`). Изменения раскатываются в открытые
  карточки через pull-команду `reload.options`.
- **UF-тип** регистрируется на установке (`userfieldtype.add`, `USER_TYPE_ID =
  type_smart_link_<dev|prod>`, `HANDLER` = URL страницы-обработчика).
- **Упаковка:** портал ждёт статический архив. `pnpm generate` → `tools/fix-paths.mjs`
  (относительные пути + `baseURL` из `window.location`) → `tools/create-archive.mjs` (zip).

## Workflow / Git

- **В `main` не пушим — только через PR.** Ветка сессии — из контекста. Мержит владелец.
- Родственный репозиторий **`bx-shef/ai-price-import`** — эталон правил/структуры/CI (тот же
  издатель и стек). Читаем как источник паттернов; правки/пуши туда не делаем.
- Живой портал/тест-данные и ключи в репозиторий не коммитим (`.env*`, кроме `*.example`).

## GitHub API Rate Limits

Квоты раздельные: REST-core (5000/час) и GraphQL (5000 очков/час). MCP-инструменты записи/поиска/
листинга идут через GraphQL — батчить записи, не молотить list/search в цикле. Помнить про
secondary limits (≈80/мин, 500/час на контент-операции) → backoff с jitter.
