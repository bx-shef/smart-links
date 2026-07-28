# SmartLinks

> Last reviewed: 2026-07-28

Bitrix24-приложение «Умные ссылки». Издатель — ИП Шевчик И.С. Nuxt 4 + Nitro: один процесс
отдаёт публичный лендинг, in-portal-страницы и `/api/*`. Приложение добавляет пользовательский тип
поля `SmartLink` и рендерит в карточке CRM «умную ссылку» на связанную сущность — с поиском,
привязкой, созданием, открытием и отвязкой.

⚠ Сейчас в роли источника поддерживается **Сделка**, целью может быть сделка или элемент Списка;
полный перечень поддерживаемого — в [`docs/PROCESS.md`](docs/PROCESS.md).

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

## Деплой (основной путь — served-процесс)

```bash
pnpm build                    # сборка Nitro (preset node-server) + пререндер маршрутов
node .output/server/index.mjs # отдаёт /, /app, /install, /handler/…, /slider/…, /api/*
```

Пути приложения в настройках портала: **`https://<host>/app`** (приложение) и
**`https://<host>/install`** (установка). Корень домена — публичный лендинг, он намеренно не
инициализирует B24-фрейм. ⚠ При смене адресов приложение нужно **переустановить**: URL
обработчика UF-типа регистрируется на установке.

### Архивная упаковка (легаси-фолбэк)

```bash
pnpm generate-archive-for-b24   # generate → fix-paths → create-archive
```

⚠ `tools/fix-paths.mjs` сейчас **инертен** (ищет маркер `dev-folder`, которого сборка не
производит) — архивный путь требует починки и проверки на живом портале.

## Скоупы Bitrix24

`user_brief`, `crm`, `list`, `placement`, `userfieldconfig`, `pull`.

## Стек

Nuxt 4 + Nitro (пререндер маршрутов, preset `node-server`), `pg`, `@bitrix24/b24ui-nuxt`,
`@bitrix24/b24jssdk`, `@nuxtjs/i18n`, `@pinia/nuxt`, Tailwind CSS (`@tailwindcss/vite`).
Пакетный менеджер — pnpm.

## Лицензия

MIT — см. [`LICENSE`](LICENSE).
