# SmartLinks

> Last reviewed: 2026-07-28

Bitrix24-приложение «Умные ссылки». Издатель ИП Шевчик И.С. Nuxt 4 + Nitro: один процесс отдаёт
публичный лендинг (`/`), in-portal-страницы (`/app`, `/install`, `/handler/…`, `/slider/…`) и
`/api/*`. Все маршруты **пререндерятся** в реальный HTML (лендинг индексируется), а Bitrix24-фрейм
поднимается **на клиенте** (`onMounted`). In-portal-код исполняется **внутри iframe
портала** (`@bitrix24/b24jssdk` → `B24Frame`): настройки поля живут в опциях портала
(`app.option.*`), обмен в реальном времени — через pull. Серверная часть хранит состояние попапа
оценки в Postgres (без `DATABASE_URL` — инертна). Архивная упаковка — легаси-фолбэк.

**Суть:** приложение регистрирует пользовательский тип поля `SmartLink`; в карточке CRM это поле
рендерится плейсментом и работает как «умная ссылка» на связанную сущность (CRM или элемент
Списка) — поиск, привязка, создание, открытие, отвязка. Полное описание —
[`docs/PROCESS.md`](docs/PROCESS.md); карта проекта и план работ — [`docs/PROJECT_MAP.md`](docs/PROJECT_MAP.md).

## Раскладка

- `app/` — Nuxt (авто-импорт):
  - `pages/` — `index.vue` (**публичный лендинг** на `/`, вне портала, `layout: false`) +
    in-portal страницы: `app` (стартовая), `install`, `handler/uf.smart-link` (обработчик
    UF-типа), `slider/app-options` (настройки, админ), `slider/feedback` (обратная связь).
    Все пререндерятся; фрейм инициализируется в `onMounted`, `<B24App>` — в layout'ах.
  - `stores/` — Pinia: `appSettings` (версия/статус/`configUfListSettings` + пути + `saveSettings`),
    `link` (текущая целевая ссылка), `page` (title/description/isLoading), `user` (`isAdmin`).
  - `composables/useB24.ts` — **единственная точка входа во фрейм**: ленивый `import()` SDK +
    идемпотентный `init()`. Статических импортов `@bitrix24/b24jssdk` в entry-графе быть не должно —
    иначе 300 КБ SDK уезжают в чанк, который грузит публичный лендинг (плагин
    `@bitrix24/b24jssdk-nuxt` по той же причине не подключён).
  - `composables/useAppInit.ts` — старт приложения: язык, `initB24Helper` (App/AppOptions/Profile),
    наполнение сторов, `processErrorGlobal`, pull-клиент.
  - `composables/usePageSeo.ts` — `<title>`/`description` in-portal страниц из стора `page`
    (геттеры, фолбэк на `app.name`, пустой `description` не эмитится).
  - `middleware/` — роутинг по `placement.options.place` (слайдеры).
  - `layouts/` / `components/` / `utils/` (чистые функции) / `assets/`.
- `shared/types/base.d.ts` — общие типы (`UfSmartLinkType`, `IStep`).
- `i18n/` — локали (`ru`) + карта локалей.
- `public/` — статика (аватары, favicon, robots).
- `tools/` — оффлайн: `translate.ui.ts` (перевод локалей через DeepSeek), `fix-paths.mjs` +
  `create-archive.mjs` (упаковка архива для B24).
- `template/` — HTML-шаблон загрузчика dev-сервера.
- `server/` — Nitro: `api/` (`health`, `app-rating` get/post), `utils/` (фрейм-токен, политика и
  store рейтинга), `db/` (`pg`-пул, схема `app_rating`), `plugins/migrate.ts`.
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
pnpm build        # served-сборка (Nitro, preset node-server) + пререндер — основной путь деплоя
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

> ⚠ **Идёт серверная миграция** (решение владельца, паритет с эталоном) — см.
> [`docs/SERVER_MIGRATION.md`](docs/SERVER_MIGRATION.md): добавлен Nitro-сервер (S1), рейтинг на
> сервере (S2: фрейм-токен + Postgres `app_rating`), дальше — деплой в Black Hole (S3) и OAuth
> (S4). Заметки ниже описывают исходную клиентскую модель; серверная часть работает и **без БД**
> (роуты рейтинга инертны без `DATABASE_URL`).

- **In-portal авторизация — на стороне портала**: фрейм получает права текущего пользователя
  (`Profile.isAdmin`), сервер верифицирует фрейм-токен. OAuth пока нет (фаза S4). Клиентских
  секретов в рантайме нет (кроме публичных `NUXT_PUBLIC_*` формы обратной связи);
  `DEEPSEEK_API_KEY` нужен **только** оффлайн-инструменту перевода.
- **Хранилище настроек — опции приложения портала** (`app.option.get/set`), ключ
  `configUfListSettings` (карта `ufCode → UfSmartLinkType`). Изменения раскатываются в открытые
  карточки через pull-команду `reload.options`.
- **UF-тип** регистрируется на установке (`userfieldtype.add`, `USER_TYPE_ID =
  type_smart_link_<dev|prod>`, `HANDLER` = URL страницы-обработчика).
- **Деплой:** основной путь — served-процесс (`pnpm build` → `node .output/server/index.mjs`).
  Пути приложения в портале: `<host>/app` и `<host>/install` (корень — лендинг).
  Архивная упаковка (`pnpm generate-archive-for-b24`) — легаси-фолбэк; ⚠ `tools/fix-paths.mjs`
  сейчас инертен (ищет несуществующий маркер `dev-folder`), требует починки перед использованием.

## Workflow / Git

- **В `main` не пушим — только через PR.** Ветка сессии — из контекста. Мержит владелец.
- Родственный репозиторий **`bx-shef/ai-price-import`** — эталон правил/структуры/CI (тот же
  издатель и стек). Читаем как источник паттернов; правки/пуши туда не делаем.
- Живой портал/тест-данные и ключи в репозиторий не коммитим (`.env*`, кроме `*.example`).

## GitHub API Rate Limits

Квоты раздельные: REST-core (5000/час) и GraphQL (5000 очков/час). MCP-инструменты записи/поиска/
листинга идут через GraphQL — батчить записи, не молотить list/search в цикле. Помнить про
secondary limits (≈80/мин, 500/час на контент-операции) → backoff с jitter.
