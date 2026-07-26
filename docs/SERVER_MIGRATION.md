# Переход на серверную архитектуру (Nitro) + деплой в Black Hole

> Last reviewed: 2026-07-26

Решение владельца (2026-07-26): **вариант (а)** — усложняем приложение до серверного. Приложение
перестаёт быть только статическим архивом и получает **серверный процесс (Nitro)**, который отдаёт
in-portal-страницы, публичный лендинг и `/api/*` — как эталон `ai-price-import`. Рейтинг переезжает
на сервер. Цель деплоя — **Bitrix24 Vibecode Black Hole** (VM, один Nitro-процесс), с прицелом на
публикацию в Маркете.

Эталон паттернов — `bx-shef/ai-price-import` (только чтение).

## Принципы

- **Один процесс** отдаёт всё: лендинг (`/`), in-portal (client-only страницы), `/api/*`
  (как в эталоне, `docs/DEPLOY_VIBECODE.md`).
- **Авторизация in-portal — фрейм-токен** (порт `resolveFrameMember` из эталона): сервер
  верифицирует фрейм-токен вызовом REST портала (bare-token) → `member_id`. OAuth **не нужен** для
  фаз S1–S3 (он только для multi-tenant облачной публикации — фаза S4).
- **Чистое ядро в `server/utils` (+ тесты)**, I/O-края тонкие. Та же конвенция, что в `app/utils`.
- **Секреты — только env**, в репозиторий/образ не коммитим.
- REST-факты Bitrix24 проверяем на живом портале, а не по памяти.

## Фазы

| Фаза | Что | Задача | Статус |
|---|---|---|---|
| S1 | Серверный каркас: Nitro, `server/api/health`, served-сборка (`nuxt build`, preset node-server), публичный лендинг-маршрут, in-portal остаётся client-only | #15 | TODO |
| S2 | Рейтинг на сервере: `server/api/app-rating` (get/post), фрейм-токен → `member_id`, хранилище per-member (лёгкое), чистая `shouldPrompt`; клиент берёт решение с сервера | #16 | TODO |
| S3 | Деплой в Black Hole: `DEPLOY_VIBECODE.md` + `deploy/vibecode-deploy.sh` + opt-in workflow + edge-security паритет + env | #17 | TODO |
| S4 | Market OAuth: install/uninstall-события + хранилище токенов (Postgres) — облачное multi-tenant приложение, как эталон | #18 | TODO |

## Решения (полный паритет эталона)

Владелец: «смотри репо примера — там всё сделано» (2026-07-26). Значит идём по эталону
`ai-price-import` **полностью**:

- **Auth:** фрейм-токен для in-portal-роутов (`resolveFrameMember` → `member_id`, порт из эталона)
  **и** полный **OAuth** для облачного Market-приложения (install/uninstall-события, хранилище
  токенов) — фаза S4 включена в план, не опциональна.
- **Хранилище:** **Postgres** (как эталон): токены порталов, состояние рейтинга (`portal_app_rating`
  по `member_id`), тумбстоуны и т.п. На Black Hole VM провижнится в `preStart` (как эталон).
- **Сборка:** `nuxt build` (preset node-server). Архивная упаковка (`tools/`) остаётся как
  фолбэк локального приложения, но основной путь — served-процесс.
- **Лендинг:** маршрут в served-приложении; in-portal-страницы — client-only (`*.html.client.vue`).
- **Edge-security:** паритет из эталона (`APP_EDGE_SECURITY`: CSP + `frame-ancestors` доменов Б24,
  анти-брутфорс, body-size) — на фазе S3.

## Что переиспользуем из уже сделанного

- `app/utils/appRating.ts` (`shouldPromptRating`) → переносим в `server/utils` (чистое решение,
  `now` инъектируется) — как `appRatingPolicy.ts` в эталоне.
- `marketDetailPath`, `NUXT_PUBLIC_B24_MARKET_CODE` — остаются; клиент открывает Маркет по решению
  **сервера** (get `/api/app-rating`).

## Прогресс

- **S2b (DB-слой рейтинга) — сделано:** чистые ядра `server/utils/appRatingPolicy.ts`
  (`shouldPrompt`, Date-based) и `server/utils/appRatingStore.ts` (DI над `QueryFn`,
  get/markPrompted/markOpened/markReviewed/clearOpened; ключ `portal_key`) — тесты фейком.
  Живой край: `server/db/query.ts` (тип `QueryFn`), `server/db/client.ts` (`pg` пул по
  `DATABASE_URL`, `dbEnabled`), `server/db/schema.ts` (таблица `app_rating`),
  `server/plugins/migrate.ts` (идемпотентная миграция на старте, **no-op без `DATABASE_URL`**).
  Проверено: `pnpm build` + `node .output/server/index.mjs` без `DATABASE_URL` стартует и отдаёт
  health (migrate тихо пропущен). ⚠ Введена зависимость **`pg`**.
- **S2a (верификация фрейм-токена) — сделано:** порт чистого ядра из эталона —
  `server/utils/b24Rest.ts` (SSRF-гард `isSafeB24Domain`, `normaliseHost`, `isAuthRejection`),
  `frameAuth.ts` (`extractFrameAuth`), `frameVerify.ts` (`verifyFrameToken` — DI, отдаёт
  `{ok, admin, host}`), живой транспорт `b24BareToken.ts` (guarded raw-fetch вместо SDK, т.к.
  b24jssdk 0.4.x). Тесты на чистое ядро. **Ключ рейтинга — `host` (нормализованный домен),
  доказанный токеном.** `member_id` недоступен до OAuth (S4) — как в эталоне (`resolveFrameMember`
  = `verifyFrameToken` + маппинг домен→member_id из token-store, который наполняет только install).
  Store фазы S2 проектируем по обобщённому ключу (`portal_key TEXT` = host сейчас, member_id после
  S4) — смена источника без миграции схемы.
- **S1 (каркас) — сделано:** Nitro-сервер, `server/api/health` (чистый `healthInfo` из
  `app/utils/build` + тесты), served-сборка `pnpm build` (preset node-server) проверена локально —
  `node .output/server/index.mjs` отдаёт `/…/api/health` → `{status:'ok',commit,commitUrl,time}`.
  CI переведён с `generate` на `build`. Серверный typecheck добавлен в `pnpm typecheck`.
  - ⚠ **baseURL `/smart-link/`**: приложение сейчас смонтировано под этим префиксом (наследие
    архивной модели), поэтому health доступен как `/smart-link/api/health`, а корень редиректит.
    Для публичного лендинга на `/` и health-check деплоя на фазе лендинга/S3 пересмотрим baseURL
    (лендинг на `/`, in-portal — под своим префиксом), сверяясь с эталоном.

## Упрочнение (будущие фазы)

- **Rate-limit роутов `/api/app-rating`**: `verifyFrameToken` делает живой `profile`-вызов к порталу
  до валидации токена — неаутентифицированный клиент может амплифицировать исходящие вызовы к
  `*.bitrix24.*`. Ограничено SSRF-гардом (только хосты Bitrix24), но нужен пер-IP/домен rate-limit
  (как `demoRateLimit`/edge-security в эталоне) — на фазе S3 (edge-security) или отдельно.

## Живые проверки на тест-портале

Тест-портал через вебхук (`.env.b24test`, `B24_HOOK`, **в репозиторий не коммитим**). Установлено:

- `app.option.*` / `user.option.*` / `userfieldtype.*` — **требуют контекст приложения**, через
  вебхук недоступны (`ACCESS_DENIED: Application context required`) → проверяемы только во фрейме
  приложения. Поэтому серверный рейтинг хранит состояние **в своей БД** (Postgres), а не в
  `app.option`/`user.option`.
- `crm.item.list` / `lists.*` через вебхук работают → используем для проверок REST-фактов.
- REST-факты Bitrix24 сверяем на этом портале, а не по памяти.
