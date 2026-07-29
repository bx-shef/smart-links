# SmartLinks

> Last reviewed: 2026-07-29

Bitrix24-приложение «Умные ссылки». Издатель ИП Шевчик И.С. Nuxt 4 + Nitro: один процесс отдаёт
публичный лендинг (`/`), in-portal-страницы (`/app`, `/install`, `/handler/…`, `/slider/…`) и
`/api/*`. Все маршруты **пререндерятся** в реальный HTML (лендинг индексируется), а Bitrix24-фрейм
поднимается **на клиенте** (`onMounted`). In-portal-код исполняется **внутри iframe
портала** (`@bitrix24/b24jssdk` → `B24Frame`): настройки поля живут в опциях портала
(`app.option.*`), обмен в реальном времени — через pull. Серверная часть хранит состояние попапа
оценки и OAuth-токены порталов в Postgres (без `DATABASE_URL` — инертна). Архивная упаковка —
легаси-фолбэк.

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
  - `composables/useB24.ts` — **единственная точка входа во фрейм**: ленивый `import()` SDK,
    идемпотентный `init()` с таймаутом. Инвариант **транзитивный**: ничто достижимое из `app.vue`,
    layout'а, глобального middleware или плагина не должно импортировать значения из
    `@bitrix24/b24jssdk` (`import type` стирается и безопасен) — иначе ~300 КБ SDK уезжают в чанк,
    который грузит публичный лендинг. Пакет `@bitrix24/b24jssdk-nuxt` по той же причине удалён.
    Неудачный handshake **кэшируется, а не ретраится**: SDK латчит `isMakeFirstCall`, и повторный
    `initializeB24Frame()` после отказа **не резолвится никогда** (проверено по исходникам SDK).
  - `composables/useAppInit.ts` — старт приложения: язык, `initB24Helper` (App/AppOptions/Profile),
    наполнение сторов, `processErrorGlobal`, pull-клиент.
  - `composables/usePageSeo.ts` — `<title>`/`description` in-portal страниц из стора `page`
    (геттеры, фолбэк на `app.name`, пустой `description` не эмитится, `robots: noindex`).
  - `composables/useAppRating.ts` — клиент серверного рейтинга (решение показа берётся с сервера).
  - `middleware/` — роутинг по `placement.options.place` (слайдеры).
  - `layouts/` / `components/` / `utils/` (чистые функции) / `assets/`.
- `shared/types/base.d.ts` — общие типы (`UfSmartLinkType`, `IStep`).
- `i18n/` — локали (`ru`) + карта локалей.
- `public/` — статика (аватары, favicon, robots).
- `tools/` — оффлайн: `translate.ui.ts` (перевод локалей через DeepSeek), `fix-paths.mjs` +
  `create-archive.mjs` (упаковка архива для B24).
- `template/` — HTML-шаблон загрузчика dev-сервера.
- `server/` — Nitro: `api/` (`health`, `app-rating` get/post, `b24/events` — вебхук install/uninstall),
  `utils/` (фрейм-токен, SSRF-гард + allowlist зон Б24, политика и store рейтинга, OAuth-хранилище
  токенов + шифрование, keep-alive, edge-защита, пер-IP лимит), `db/` (`pg`-пул, схемы `app_rating`,
  `portal_tokens`, `portal_tombstone`), `middleware/edgeSecurity.ts` (кап тела),
  `plugins/` (`migrate`, `edgeHeaders`, `maintenance`).
- `deploy/` + `.github/workflows/deploy-vibecode.yml` — деплой в Bitrix24 Vibecode Black Hole
  (**opt-in**, см. [`docs/DEPLOY_VIBECODE.md`](docs/DEPLOY_VIBECODE.md)).
- `docs/` — документация (см. [`docs/README.md`](docs/README.md)).

**Скоупы приложения:** `user_brief`, `crm`, `lists`, `placement`, `userfieldconfig`, `pull`.
⚠ Именно `lists`, а не `list` — кода `list` в перечне скоупов Битрикса нет, и с ним
`lists.element.*` вернул бы `insufficient_scope`, то есть половина функции «умной ссылки»
(цель — элемент Списка) просто не работала бы.

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

> **Серверная миграция завершена кодом** (решение владельца, паритет с эталоном) — см.
> [`docs/SERVER_MIGRATION.md`](docs/SERVER_MIGRATION.md): Nitro-сервер (S1), рейтинг на сервере
> (S2), деплой в Black Hole (S3), Market OAuth (S4). ⚠ S3 и S4 **на живом портале/платформе не
> прогонялись**. Приложение работает и **без БД**, и без OAuth-кредов: роуты рейтинга инертны без
> `DATABASE_URL`, вебхук установки отвечает 503, ключ рейтинга падает обратно на проверенный хост.

- **In-portal авторизация — на стороне портала**: фрейм получает права текущего пользователя
  (`Profile.isAdmin`), сервер верифицирует фрейм-токен. Клиентских
  секретов в рантайме нет (кроме публичных `NUXT_PUBLIC_*` формы обратной связи);
  `DEEPSEEK_API_KEY` нужен **только** оффлайн-инструменту перевода.
- **Хранилище настроек — опции приложения портала** (`app.option.get/set`), ключ
  `configUfListSettings` (карта `ufCode → UfSmartLinkType`). Изменения раскатываются в открытые
  карточки через pull-команду `reload.options`.
- **UF-тип** регистрируется на установке (`userfieldtype.add`, `USER_TYPE_ID =
  type_smart_link_<dev|prod>`, `HANDLER` = URL страницы-обработчика).
- **Market OAuth (S4)** — вебхук `POST /api/b24/events` (ONAPPINSTALL/ONAPPUNINSTALL), таблица
  `portal_tokens` (ключ `member_id`), `refresh_token` шифруется **AES-256-GCM**
  (`B24_TOKEN_ENC_KEY`; без ключа установка отвечает 503, а не кладёт долгоживущий секрет
  открытым текстом). Доверие по докам Б24: у **известного** портала событие сверяется с его
  **сохранённым** `application_token` (только так аутентифицируется ONAPPUNINSTALL: блок `auth` у
  него есть, но без `access_token`/`refresh_token` — права уже отозваны, сверять больше не с чем),
  у **первой** установки токена ещё нет → доказываем контроль домена вызовом `profile`
  **и** привязываем `member_id` к гранту (`verifyInstallMember`: рефреш присланного токена
  возвращает authoritative `member_id`; иначе владелец любого портала мог бы отравить чужой
  `member_id`). Рефреш **ротирует** грант ⇒ храним возвращённый.
- **Порядок событий** — Б24 события не упорядочивает и не ретраит: тумбстоун `portal_tombstone`
  не даёт запоздавшему install воскресить удалённый портал. Рост ограничен `TOMBSTONE_TTL_DAYS`.
- **Keep-alive рефреш** (`plugins/maintenance.ts`): `refresh_token` живёт ~180 дней **от выдачи**
  (докой подтверждено), поэтому простаивающий портал молча терял бы доступ — проход рефрешит только
  те, что подходят к сроку (порог 60 дней, батч 50). ⚠ Целевая платформа **усыпляет** сервер после
  часа простоя, поэтому одного `setInterval` мало: проходы дополнительно запускаются **по входящему
  запросу** с проверкой «прошёл ли интервал», а владельцу нужен внешний суточный пинг
  (см. `docs/DEPLOY_VIBECODE.md`). Таймеры рассчитаны на **один процесс**; при scale-out нужен лок.
- **Подписка на события** — `event.bind` в мастере установки (`app/utils/b24EventBind.ts`, чистый
  билдер плана с тестами): без неё ONAPPUNINSTALL **не приходит вовсе**, и после удаления
  приложения креды клиента остались бы у нас навсегда. Идемпотентно: корректная подписка не
  трогается, устаревшая (со старого домена) перенавешивается.
- **Наблюдаемость:** OAuth-часть невидима из UI (страницы работают и без единого
  зарегистрированного портала), поэтому на старте печатается строка конфигурации
  (`db`/`oauth`/`encryption`/`keepalive`), каждый исход вебхука логируется, а `/api/health` отдаёт
  булевы флаги готовности. Идентификатор портала в логи не попадает — только `portalHash`.
- **Ключ рейтинга** — `member_id` установленного портала, с фолбэком на проверенный хост
  (`portalKeyForHost`): хост меняется при переименовании портала, `member_id` — нет.
- **Тема — принудительно светлая, и это осознанно.** `b24ui.colorMode: false` в `nuxt.config.ts`,
  поэтому модуль `@nuxtjs/color-mode` не ставится и класс `.dark`/`.light` никто не выставляет;
  layout'ы пришпиливают `light` через `bodyAttrs` (там же живут варианты
  `light:[--air-theme-bg-color:…]`), поверхности — токен `--ui-color-base-white-fixed`, а не
  `bg-white`. ⚠ Автотему включать **нельзя вслепую**: Битрикс24 **не передаёт тему портала** во
  фрейм плейсмента (в типах `@bitrix24/b24jssdk` такого поля нет, в `placement.options` — тоже),
  а `prefers-color-scheme` внутри iframe — это тема **ОС**, не портала. То есть «авто» починило бы
  тёмный портал на тёмной ОС и **сломало** светлый портал на тёмной ОС. Единственный корректный
  сигнал — `color-scheme`, пробрасываемый браузером от документа-родителя; **проверить на живом
  портале в тёмной теме** (Block 1, за владельцем), и только потом включать. `app/app.config.ts`
  с `colorMode`/`colorModeInitialValue` заводить бессмысленно: b24ui эти ключи не читает.
- **Без обратного прокси приложение само вешает edge-защиту** — флаг `APP_EDGE_SECURITY=1`
  (`server/utils/edgeSecurity.ts` + `plugins/edgeHeaders.ts`): CSP с `frame-ancestors` доменов Б24,
  `nosniff`, `Referrer-Policy`, HSTS на **все** ответы + кап тела запроса. Заголовки вешает
  **плагин** на хук `beforeResponse`, а не middleware: Nitro отдаёт пререндеренные страницы
  обработчиком public-assets **до** middleware, и HTML уходил бы вообще без CSP (проверено).
  За прокси флаг **не** ставим — два CSP браузер пересекает рестриктивно.
- **Пер-IP лимит на `/api/app-rating`** работает независимо от флага: каждый вызов тратит исходящий
  `profile`-запрос в портал на проверку фрейм-токена. Ключ — реальный TCP-пир; `X-Forwarded-For`
  учитывается только при `APP_EDGE_TRUST_XFF=1`.
- **SSRF-гард — явный список зон** (`B24_ZONES`), а не `bitrix24.<любой TLD>`: свободный TLD может
  зарегистрировать кто угодно, а «проверка» фрейм-токена — это ответ самого хоста. ⚠ Список
  собран по наблюдениям, **сверить с живым Маркетом**; расширяется через `B24_EXTRA_ZONES`.
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
