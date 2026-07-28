# SmartLinks

> Last reviewed: 2026-07-28

Bitrix24-приложение «Умные ссылки». Издатель — ИП Шевчик И.С. Клиентское Nuxt 4-приложение,
которое добавляет пользовательский тип поля `SmartLink` и рендерит в карточке CRM «умную
ссылку» на связанную сущность (другую CRM-сущность или элемент Списка) — с поиском, привязкой,
созданием, открытием и отвязкой.

In-portal страницы исполняются **внутри iframe портала** (обёртка `@bitrix24/b24jssdk`):
авторизация — на стороне портала, настройки поля — в опциях приложения (`app.option.*`),
реалтайм — через pull. Рядом работает **серверная часть** (Nitro): публичный лендинг на `/`,
`/api/health` и серверное состояние попапа оценки (`/api/app-rating`, Postgres). Без
`DATABASE_URL` приложение работает — серверный рейтинг просто инертен. Идёт миграция к паритету
эталона — см. [`docs/SERVER_MIGRATION.md`](docs/SERVER_MIGRATION.md).

- Полное описание процесса — [`docs/PROCESS.md`](docs/PROCESS.md).
- Карта проекта, план работ и конвенции — [`docs/PROJECT_MAP.md`](docs/PROJECT_MAP.md).
- Памятка по раскладке и правилам — [`CLAUDE.md`](CLAUDE.md).

## Быстрый старт

```bash
pnpm install
cp .env.example .env      # заполнить NUXT_PUBLIC_B24_FORM_* (обратная связь), при переводе — DEEPSEEK_API_KEY
pnpm dev                  # дев-сервер (для работы внутри портала нужен туннель, см. NUXT_ALLOWED_HOSTS)
```

## Сборка архива для портала

```bash
pnpm generate-archive-for-b24   # generate → fix-paths → create-archive
# итог: .output/archiverForB24.zip — загрузить как локальное/маркет-приложение Bitrix24
```

## Скоупы Bitrix24

`user_brief`, `crm`, `list`, `placement`, `userfieldconfig`, `pull`.

## Стек

Nuxt 4 (`ssr: false`), `@bitrix24/b24ui-nuxt`, `@bitrix24/b24jssdk(-nuxt)`, `@nuxtjs/i18n`,
`@pinia/nuxt`, `@unovis/vue`, Tailwind CSS. Пакетный менеджер — pnpm.

## Лицензия

MIT — см. [`LICENSE`](LICENSE).
