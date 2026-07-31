# Как работает «Умные ссылки» (SmartLinks) — описание процесса

> Last reviewed: 2026-07-29

Приложение Bitrix24 «Умные ссылки». Издатель — ИП Шевчик И.С. **Nuxt 4 + Nitro**: один
процесс отдаёт публичный лендинг (`/`), in-portal-страницы и `/api/*`. Все маршруты
**пререндерятся** в реальный HTML, а Bitrix24-фрейм поднимается **на клиенте** — поэтому
in-portal-код исполняется **внутри iframe портала** (обёртка `@bitrix24/b24jssdk` →
`B24Frame`): настройки поля хранятся в опциях приложения на стороне портала
(`app.option.*`), обмен в реальном времени — через pull. Серверная часть держит состояние
попапа оценки в Postgres (без `DATABASE_URL` — инертна). Упаковка в архив — легаси-фолбэк.

## Суть продукта

Приложение добавляет в портал **пользовательский тип поля** `SmartLink`
(`userfieldtype`). Администратор создаёт UF-поле этого типа на нужной CRM-сущности
(например, на Сделке). Дальше это поле рендерится прямо в карточке сущности через
**плейсмент-обработчик** (iframe) и работает как «умная ссылка» на связанную **целевую
сущность** — другую CRM-сущность или элемент Списка (инфоблока).

В карточке пользователь может:

- **найти** кандидатов для связи (поиск по названию/ID; фильтр по компании/контакту исходной
  сущности — **опционален**, включается в настройках поля, по умолчанию выключен);
- **привязать** выбранную целевую сущность (её ID пишется в UF-поле-приёмник);
- **открыть** связанную сущность (CRM — в слайдере, элемент Списка — в новой вкладке);
- **создать** новую целевую сущность (для Списков — с предзаполнением компании/контакта; для
  CRM предзаполнение пока не реализовано, `@todo` в обработчике);
- **отвязать** текущую связь.

⚠ **Поддерживаемые цели.** `entityMode` — `crm` или `lists`. В режиме `crm` резолверы путей
(`appSettings.getTargetPath`/`getNewTargetPath`) сейчас поддерживают **только Сделку**
(`EnumCrmEntityTypeId.deal`); редактор настроек соответственно предлагает один CRM-тип. Другие
CRM-сущности требуют расширения резолверов.

**Скоупы приложения:** `user_brief`, `crm`, `lists`, `placement`, `userfieldconfig`, `pull`.
⚠ Именно `lists`, а не `list` — кода `list` в перечне скоупов Битрикса нет, и с ним
`lists.element.*` вернул бы `insufficient_scope`, то есть половина функции «умной ссылки»
(цель — элемент Списка) просто не работала бы.

## Раскладка (что где)

- `app/` — Nuxt (авто-импорт): `pages` (пререндерятся в статический HTML) / `layouts` /
  `components` / `composables` / `stores` (Pinia) / `middleware` / `utils` / `assets`.
- `shared/types/base.d.ts` — общие типы (`UfSmartLinkType`, `IStep`).
- `i18n/` — локали (`ru`) + карта локалей + опции.
- `public/` — статика (аватары советника, favicon, robots).
- `tools/` — оффлайн-инструменты: перевод локалей и упаковка архива для B24.
- `template/` — HTML-шаблон загрузчика dev-сервера.
- `scripts/b24-smoke.mjs` — живая сверка REST-фактов с порталом (см. CLAUDE.md).
- `server/` — Nitro: `api/` (`health`, `app-rating` get/post, `b24/events` — вебхук
  install/uninstall), `utils/` (фрейм-токен, SSRF-гард, политика и store рейтинга, OAuth-хранилище
  токенов + шифрование AES-256-GCM, keep-alive, edge-защита, пер-IP лимит), `db/` (`pg`-пул, схемы
  `app_rating`/`portal_tokens`/`portal_tombstone`), `middleware/edgeSecurity.ts`,
  `plugins/` (`migrate`, `edgeHeaders`, `maintenance`). Подробно — `docs/SERVER_MIGRATION.md` и
  `docs/DATA_POLICY.md`.

## Страницы и роли

Все страницы **пререндерятся** в реальный HTML; Bitrix24-фрейм поднимается на клиенте
(`onMounted`), поэтому страницы открываются и вне портала. Публичный лендинг на `/`
(`pages/index.vue`, `layout: false`) фрейм не инициализирует вовсе — он индексируется поисковиками.

| Страница | Плейсмент/место | Что делает |
|---|---|---|
| `pages/index.vue` (`/`) | публичный лендинг (вне портала) | Маркетинговая страница: что делает приложение, как работает, издатель. |
| `pages/privacy.vue` (`/privacy`) | публичная (вне портала) | Политика конфиденциальности — постоянный URL для карточки Маркета. Вторая публичная страница в `isPublicRoute`. |
| `pages/app.vue` (`/app`) | стартовая (левое меню портала) | Приветствие + кнопка открыть список UF-полей для Сделок. |
| `pages/install.vue` (`/install`) | установка | Мастер установки: шаги `init → demo → events → userFields → finish`. `events` подписывает вебхук на ONAPPINSTALL/ONAPPUNINSTALL/ONAPPUPDATE, `userFields` регистрирует тип поля, `finish` — `installFinish()` с конфетти. |
| `pages/handler/uf.smart-link.vue` | обработчик UF-типа (в карточке) | Главная логика поля: читает конфиг, грузит источник и цель, показывает ссылку/подбор, выполняет действия. |
| `pages/slider/app-options.vue` | слайдер настроек приложения | Редактор настроек поля (**только админ**). Сохраняет `app.option.set` и рассылает pull. |
| `pages/slider/feedback.vue` | слайдер обратной связи | Встраивает CRM-форму Bitrix24 в iframe, прокидывает свойства портала. |

## Процесс: установка

Страница установки (`/install`) проходит шаги последовательно:

1. `init` — подготовка.
2. `demo` — заглушка примеров.
3. `events` — **подписка на события установки**: `event.get` + план `buildEventBindCalls`
   (`app/utils/b24EventBind.ts`) навешивает `ONAPPINSTALL`/`ONAPPUNINSTALL`/`ONAPPUPDATE` на наш
   вебхук `/api/b24/events`. Идемпотентно: корректная подписка не трогается, устаревшая (со старого
   домена) перенавешивается. **Критичный шаг**: без него событие удаления не придёт вовсе, и креды
   клиента останутся у издателя навсегда (см. `docs/DATA_POLICY.md`).
4. `userFields` — регистрирует тип поля: `userfieldtype.add` с
   `USER_TYPE_ID = type_smart_link_<dev|prod>`, `HANDLER = <appUrl>handler/uf.smart-link`,
   `TITLE = [dev|prod] SmartLink`, `OPTIONS.height = PLACEMENT_MIN_HEIGHT` (85, общая константа с floor плейсмента). Перед добавлением — `userfieldtype.delete`
   (идемпотентность). `appUrl` вычисляется из текущего URL страницы установки.
5. `finish` — прогресс 100%, конфетти, `installFinish()`.

После установки администратор в интерфейсе Bitrix24 создаёт UF-поле типа `SmartLink` на
нужной сущности и настраивает его (см. «Настройки поля»).

## Процесс: поле в карточке (`handler/uf.smart-link`)

При открытии карточки сущности портал загружает обработчик в iframe и передаёт
`placement.options`:

- `FIELD_NAME` → `ufCode` (код текущего UF-поля);
- `ENTITY_DATA.entityTypeId` / `entityId` → текущая (исходная) сущность;
- `MODE` (`edit`/`view`) — режим редактирования **не поддерживается** (показывается совет
  сохранить и продолжить в режиме просмотра).

Алгоритм `loadData()`:

1. Берёт конфиг поля `configUfSetting = appSettings.configUfListSettings[ufCode]`. Нет
   конфига → показывает «Поле ещё не настроено» (админу — кнопка в настройки).
2. Читает **исходную** сущность (`crm.item.list` по `entityId`), достаёт значение
   поля-приёмника (`ufDestination`) и клиентские поля (companyId/contactId) для фильтров.
3. Если приёмник пуст → режим **подбора**: `preLoadData()` грузит список кандидатов из
   цели (`crm.item.list` для `entityMode='crm'` или `lists.element.get` для `'lists'`), с
   учётом `customFilter` и фильтров по компании/контакту источника, плюс поиск по
   `filterTitle` (ID или `%title%`).
4. Если приёмник заполнен → грузит **целевую** сущность и показывает готовую ссылку
   (название + ID). Если цель не находится (удалена/нет прав) — показывает «Связанная запись удалена или закрыта правами доступа».

Действия пользователя:

- `makeAddLink(entity)` — пишет `entity.id` в `ufDestination` через `crm.item.update`,
  затем перечитывает данные.
- `makeUnLink()` — очищает `ufDestination` через `crm.item.update`.
- `makeOpenLink` / `makeOpenLinkById` — открывает целевую сущность: `slider.openPath` для
  CRM, `window.open` для Списков.
- `addNewEntity()` — открывает форму создания целевой сущности. Для Списков предзаполняет
  компанию/контакт через query-параметры и отслеживает закрытие окна; для CRM открывает форму
  без подстановки (`@todo` в обработчике).

**Реалтайм:** обработчик подписывается на pull-команду `reload.options` (модуль `main`);
при её получении перечитывает опции приложения и данные поля. Команду рассылает страница
настроек после сохранения.

**Размер окна** плейсмента подстраивается под состояние (`parent.resizeWindow`).

## Процесс: настройки поля (`slider/app-options`)

Открывается из плейсмента (кнопка «Настройки», видна админу) через
`slider.openSliderAppPage({ place: 'app-options', ufCode })`. Доступ — **только админ**
(иначе ошибка). Редактирует объект `UfSmartLinkType` для конкретного `ufCode`, сохраняет
через `appSettings.saveSettings()` → `app.option.set { configUfListSettings }`, затем
рассылает pull `reload.options`, чтобы открытые карточки перечитали конфиг.

Редактор реализован (b24ui-форма: поле-приёмник **выбором из полей карточки**, режим цели
`crm`/`lists`, список — **выбором из перечня** с автоопределением раздела (`iblockTypeId`) или
вводом номера с резолвом раздела через `lists.get.iblock.type.id`,
поля сопоставления, свитчи фильтров, доп. фильтр JSON) с валидацией. Конфиг **загружается из опций
портала** (`initFromBatch` → `appOptions.getJsonObject('configUfListSettings')`), захардкоженных
дефолтов конкретного портала больше нет. Дальнейшие улучшения (пикеры для полей компании/контакта
цели вместо ручного ввода
кодов) — см. [`PROJECT_MAP.md`](PROJECT_MAP.md).

## Модель конфигурации (`UfSmartLinkType`)

Одна запись на каждый `ufCode` (`shared/types/base.d.ts`):

- `ufDestination` — код UF-поля-приёмника, куда пишется ID цели.
- `orign` — **источник** (сущность карточки): `clientFields` (какие поля хранят
  company/contact/myCompany/dogovor) + `isFilterBy` (по каким из них фильтровать цель).
- `target` — **цель**: `entityMode` (`'crm' | 'lists'`), `entityTypeId`, опциональный
  `customFilter`, `clientFields` (поля цели для сопоставления с company/contact источника).

## Инициализация и общие механизмы

- `composables/useAppInit.ts` — единая точка старта: `initLang` (локаль из `$b24.getLang()`),
  `initB24Helper` (грузит `App`, `AppOptions`, `Profile` одним батчем), наполняет сторы,
  плюс `processErrorGlobal` (единый показ ошибок через `showError`/404) и pull-клиент.
- Сторы (Pinia): `appSettings` (версия/статус/`isTrial`/`configUfListSettings` + пути к
  сущностям + `saveSettings`), `link` (текущая целевая ссылка), `page` (title/description/
  isLoading), `user` (`isAdmin`).
- `middleware/01.app.page.or.slider.global.ts` — по `placement.options.place` роутит на
  страницу слайдера (`app-options`/`feedback`).
- Обратная связь (`slider/feedback`) — CRM-форма Bitrix24 в iframe по
  `b24FormId`/`b24FormSecret`/`b24FormLoaderScript` (env `NUXT_PUBLIC_B24_FORM_*`), с
  прокидыванием свойств портала (домен, статус приложения, план, дни).

## i18n

`@nuxtjs/i18n`, стратегия `no_prefix`, единственная локаль `ru` (`defaultLocale: 'ru'`).
Инструмент `tools/translate.ui.ts` умеет доперевести локали через DeepSeek (OpenAI SDK,
`DEEPSEEK_API_KEY`) — оффлайн, в рантайм не входит.

## Сборка и деплой

**Основной путь — served-процесс** (Nitro, цель — Black Hole/Маркет): один процесс отдаёт
лендинг `/`, in-portal-страницы (`/app`, `/install`, `/handler/…`, `/slider/…`) и
`/api/*`.

```bash
pnpm build                    # served-сборка (preset node-server)
node .output/server/index.mjs # /, /app, /install, /handler/uf.smart-link, /slider/*, /api/*
```

⚠ **Пути приложения в настройках портала:** путь приложения — `https://<host>/app`,
установочный — `https://<host>/install`. Указывать корень домена **нельзя** — там публичный
лендинг, который намеренно не инициализирует B24-фрейм.

**Архивный путь (легаси-фолбэк)** — статический архив для локального приложения:

```bash
pnpm generate-archive-for-b24  # generate → fix-paths → create-archive
```

- `tools/create-archive.mjs` — пакует `.output/public` в zip (`archiver`).
- ⚠ `tools/fix-paths.mjs` ищет маркер `dev-folder`, которого текущая сборка **не производит**
  (`buildAssetsDir` не переопределён) → утилита фактически **инертна**, и архив содержит
  абсолютные пути от корня. Архивный путь требует починки и живой проверки на портале, прежде
  чем им пользоваться; served-деплой это не затрагивает.

## Стек

Nuxt 4 + Nitro (пререндер маршрутов, preset `node-server`), `pg`, `@bitrix24/b24ui-nuxt`,
`@bitrix24/b24jssdk`, `@bitrix24/b24icons-vue`, `@nuxtjs/i18n`, `@pinia/nuxt`,
Tailwind CSS (через `@tailwindcss/vite`). Инструменты разработки: ESLint
(`@nuxt/eslint`), TypeScript, `openai` + `tsx` + `consola` (для оффлайн-перевода локалей),
`archiver` + `glob` (упаковка архива). Пакетный менеджер — pnpm.

> Модуль `@bitrix24/b24jssdk-nuxt` **не** используется: его плагин импортирует SDK статически, и
> тот уезжает в entry-чанк, который грузит публичный лендинг. Фрейм поднимает
> `app/composables/useB24.ts` ленивым `import()`.

## Конфигурация окружения

Полный список с комментариями — в [`.env.example`](../.env.example). Ключевое:

**Запекаются на СБОРКЕ** (пререндер замораживает `runtimeConfig.public` в HTML — задать только в
рантайме недостаточно, см. таблицу в [`SERVER_MIGRATION.md`](SERVER_MIGRATION.md)):
- `NUXT_PUBLIC_B24_FORM_ID` / `_SECRET` / `_LOADER_SCRIPT` — CRM-форма обратной связи.
- `NUXT_PUBLIC_SITE_URL` — `canonical`/`og:url` лендинга (должен быть абсолютным http(s)-URL).
- `NUXT_PUBLIC_B24_MARKET_CODE` — попап «оцените приложение».
- `NUXT_PUBLIC_COMMIT_SHA` — ссылка на сборку в футере лендинга и в `/api/health`.

**Рантайм (сервер):**
- `DATABASE_URL` — Postgres для состояния попапа оценки; пусто ⇒ роуты рейтинга инертны.
- `APP_EDGE_SECURITY` — `1`, если перед процессом нет обратного прокси (см.
  [`DEPLOY_VIBECODE.md`](DEPLOY_VIBECODE.md)); за прокси **не** ставить.
- `APP_EDGE_TRUST_XFF` — `1`, только если проверено, что впереди доверенный прокси.
- `B24_EXTRA_ZONES` — дополнительные облачные зоны Б24 для SSRF-allowlist.

**Оффлайн/dev:**
- `DEEPSEEK_API_KEY` — только для `tools/translate.ui.ts` (в рантайм не попадает).
- `B24_HOOK` — вебхук живого тест-портала; хранить в `.env.b24test` (gitignored), не в репозитории.
- `NUXT_ALLOWED_HOSTS` — доверенные хосты для dev-туннелей (например, ngrok).
