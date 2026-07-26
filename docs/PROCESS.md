# Как работает «Умные ссылки» (SmartLinks) — описание процесса

> Last reviewed: 2026-07-26

Приложение Bitrix24 «Умные ссылки». Издатель — ИП Шевчик И.С. Это **клиентское**
(`ssr: false`) Nuxt 4-приложение, которое собирается в статику и упаковывается в
**архив** для загрузки в портал как локальное/маркет-приложение. Весь код исполняется
**внутри iframe портала** (обёртка `@bitrix24/b24jssdk` → `B24Frame`); своего сервера/БД у
приложения нет — состояние хранится в опциях приложения на стороне портала
(`app.option.*`), обмен в реальном времени — через pull.

## Суть продукта

Приложение добавляет в портал **пользовательский тип поля** `SmartLink`
(`userfieldtype`). Администратор создаёт UF-поле этого типа на нужной CRM-сущности
(например, на Сделке). Дальше это поле рендерится прямо в карточке сущности через
**плейсмент-обработчик** (iframe) и работает как «умная ссылка» на связанную **целевую
сущность** — другую CRM-сущность или элемент Списка (инфоблока).

В карточке пользователь может:

- **найти** кандидатов для связи (поиск по названию/ID, с автоматическим фильтром по
  компании/контакту исходной сущности);
- **привязать** выбранную целевую сущность (её ID пишется в UF-поле-приёмник);
- **открыть** связанную сущность в слайдере;
- **создать** новую целевую сущность с предзаполнением;
- **отвязать** текущую связь.

**Скоупы приложения:** `user_brief`, `crm`, `list`, `placement`, `userfieldconfig`, `pull`.

## Раскладка (что где)

- `app/` — Nuxt (авто-импорт): `pages` (генерятся в статические `*.html`) / `layouts` /
  `components` / `composables` / `stores` (Pinia) / `middleware` / `utils` / `assets`.
- `shared/types/base.d.ts` — общие типы (`UfSmartLinkType`, `IStep`).
- `i18n/` — локали (`ru`) + карта локалей + опции.
- `public/` — статика (аватары советника, favicon, robots).
- `tools/` — оффлайн-инструменты: перевод локалей и упаковка архива для B24.
- `template/` — HTML-шаблон загрузчика dev-сервера.
- `server/tsconfig.json` — только конфиг типов (полноценного сервера у приложения нет).

## Страницы и роли

Все страницы — client-only (`*.html.client.vue`), после `generate` превращаются в
статические `*.html`, на которые ссылается портал.

| Страница | Плейсмент/место | Что делает |
|---|---|---|
| `pages/index.html` | стартовая (левое меню портала) | Приветствие + кнопка открыть список UF-полей для Сделок. |
| `pages/install.html` | установка | Мастер установки: шаги `init → demo → userFields → finish`. На шаге `userFields` регистрирует тип поля (`userfieldtype.delete` + `userfieldtype.add`), на `finish` — `installFinish()` c конфетти. |
| `pages/handler/uf.smart-link.html` | обработчик UF-типа (в карточке) | Главная логика поля: читает конфиг, грузит источник и цель, показывает ссылку/подбор, выполняет действия. |
| `pages/slider/app-options.html` | слайдер настроек приложения | Редактор настроек поля (**только админ**). Сохраняет `app.option.set` и рассылает pull. ⚠ Сейчас — заглушка (`@todo`). |
| `pages/slider/feedback.html` | слайдер обратной связи | Встраивает CRM-форму Bitrix24 в iframe, прокидывает свойства портала. |

## Процесс: установка

`pages/install.html` проходит шаги последовательно:

1. `init` — подготовка.
2. `demo` — заглушка примеров.
3. `userFields` — регистрирует тип поля: `userfieldtype.add` с
   `USER_TYPE_ID = type_smart_link_<dev|prod>`, `HANDLER = <appUrl>handler/uf.smart-link.html`,
   `TITLE = [dev|prod] SmartLink`, `OPTIONS.height = 65`. Перед добавлением — `userfieldtype.delete`
   (идемпотентность). `appUrl` вычисляется из текущего URL страницы установки.
4. `finish` — прогресс 100%, конфетти, `installFinish()`.

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
   конфига → показывает «Необходимо настроить поле» (админу — кнопка в настройки).
2. Читает **исходную** сущность (`crm.item.list` по `entityId`), достаёт значение
   поля-приёмника (`ufDestination`) и клиентские поля (companyId/contactId) для фильтров.
3. Если приёмник пуст → режим **подбора**: `preLoadData()` грузит список кандидатов из
   цели (`crm.item.list` для `entityMode='crm'` или `lists.element.get` для `'lists'`), с
   учётом `customFilter` и фильтров по компании/контакту источника, плюс поиск по
   `filterTitle` (ID или `%title%`).
4. Если приёмник заполнен → грузит **целевую** сущность и показывает готовую ссылку
   (название + ID). Если цель не находится (удалена/нет прав) — показывает `????`.

Действия пользователя:

- `makeAddLink(entity)` — пишет `entity.id` в `ufDestination` через `crm.item.update`,
  затем перечитывает данные.
- `makeUnLink()` — очищает `ufDestination` через `crm.item.update`.
- `makeOpenLink` / `makeOpenLinkById` — открывает целевую сущность: `slider.openPath` для
  CRM, `window.open` для Списков.
- `addNewEntity()` — открывает форму создания целевой сущности с предзаполнением полей
  компании/контакта (для Списков — через query-параметры и отслеживание закрытия окна).

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

> ⚠ **Текущее состояние — заглушка.** UI редактора не реализован (`@todo`); конфиг задаётся
> руками в `app/stores/appSettings.ts`, а загрузка сохранённого конфига из опций в
> `initFromBatch` закомментирована. Это ключевой незакрытый кусок продукта — см.
> [`PROJECT_MAP.md`](PROJECT_MAP.md).

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
  isLoading), `user` (`login`/`isAdmin`).
- `middleware/01.app.page.or.slider.global.ts` — по `placement.options.place` роутит на
  страницу слайдера (`app-options`/`feedback`/`main`).
- Обратная связь (`slider/feedback`) — CRM-форма Bitrix24 в iframe по
  `b24FormId`/`b24FormSecret`/`b24FormLoaderScript` (env `NUXT_PUBLIC_B24_FORM_*`), с
  прокидыванием свойств портала (домен, статус приложения, план, дни).

## i18n

`@nuxtjs/i18n`, стратегия `no_prefix`, единственная локаль `ru` (`defaultLocale: 'ru'`).
Инструмент `tools/translate.ui.ts` умеет доперевести локали через DeepSeek (OpenAI SDK,
`DEEPSEEK_API_KEY`) — оффлайн, в рантайм не входит.

## Сборка и упаковка в архив B24

Приложение отдаётся порталу как статический архив:

```bash
pnpm generate                 # SSG-сборка в .output/public
pnpm tools:fix-paths          # переписывает пути под baseURL портала (/smart-link/)
pnpm tools:create-archive     # zip .output/public → .output/archiverForB24.zip
# всё вместе:
pnpm generate-archive-for-b24
```

- `tools/fix-paths.mjs` — заменяет `dev-folder`-пути на относительные и вычисляет `baseURL`
  из `window.location.pathname` (портал монтирует приложение по своему пути).
- `tools/create-archive.mjs` — пакует `.output/public` в zip (`archiver`) для загрузки в
  портал.

## Стек

Nuxt 4 (`ssr: false`), `@bitrix24/b24ui-nuxt`, `@bitrix24/b24jssdk(-nuxt)`,
`@bitrix24/b24icons-vue`, `@nuxtjs/i18n`, `@pinia/nuxt`, `@unovis/vue` (графики),
`luxon`, Tailwind CSS (через `@tailwindcss/vite`). Инструменты разработки: ESLint
(`@nuxt/eslint`), TypeScript, `openai` + `tsx` + `consola` (для оффлайн-перевода локалей),
`archiver` (упаковка). Пакетный менеджер — pnpm.

## Конфигурация окружения

- `NUXT_PUBLIC_B24_FORM_ID` / `NUXT_PUBLIC_B24_FORM_SECRET` / `NUXT_PUBLIC_B24_FORM_LOADER_SCRIPT`
  — CRM-форма обратной связи.
- `DEEPSEEK_API_KEY` — только для `tools/translate.ui.ts` (в рантайм не попадает).
- `NUXT_ALLOWED_HOSTS` — доверенные хосты для dev-туннелей (например, ngrok).
