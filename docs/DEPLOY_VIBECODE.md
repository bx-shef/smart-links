# Деплой в Битрикс24 Вайбкод Black Hole

> Last reviewed: 2026-07-28

Как выложить «Умные ссылки» в **Битрикс24 Vibecode Black Hole** — закрытую Bitrix-Cloud VM,
управляемую по REST (без SSH). Приложение слушает `:3000`, платформа отдаёт его по HTTPS на
`https://app-{id}.vibecode.bitrix24.tech`.

> ⚠ **Ничего из описанного ещё не проверено на живой платформе.** Скрипт и workflow написаны по
> документации Deploy API и по образцу родственного репозитория `bx-shef/ai-price-import`, где
> тот же путь уже пройден. Первый деплой делать **вручную** и сверять по чек-листу в конце.

## Почему это подходит

Приложение — **один Nitro-процесс**: `pnpm build` (пресет `node-server`) + `nitro.prerender.routes`
пекут лендинг и in-portal-страницы в `.output/public`, и **тот же** node-сервер отдаёт и их, и
`/api/*`. Отдельная статическая сборка (`nuxt generate`) для Black Hole не нужна, разделения на
роли/воркеры у нас нет.

Внешних зависимостей почти нет: Postgres нужен **только** для состояния попапа оценки, и без
`DATABASE_URL` приложение работает целиком, просто попап не всплывает. Очередей, Redis и OCR у нас
нет — в отличие от эталона, `preStart` может быть пустым.

## Что теряется без обратного прокси — и как это закрывается

В Black Hole перед процессом нет nginx, значит некому отдавать security-заголовки и резать тело
запроса. Приложение делает это само по флагу **`APP_EDGE_SECURITY=1`**
(`server/utils/edgeSecurity.ts` — чистое ядро с тестами, `server/middleware/edgeSecurity.ts` —
проводка):

1. **Заголовки на все ответы:** `Content-Security-Policy` (в т.ч. `frame-ancestors` доменов Б24 —
   без них портал не сможет открыть приложение в iframe), `X-Content-Type-Options: nosniff`,
   `Referrer-Policy`, `Strict-Transport-Security`.
   `X-Frame-Options` намеренно **не** ставим — он сломал бы iframe и не умеет wildcard-доменов.
   Для `/slider/feedback` отдаётся расслабленный CSP: страница строит `srcdoc`-iframe с загрузчиком
   CRM-формы Битрикса, а `srcdoc`-документ **наследует CSP встраивающей страницы**.
2. **Кап на тело запроса** (`EDGE_MAX_BODY_BYTES`, 256 КБ — загрузок у приложения нет): заявленный
   `Content-Length` больше капа → 413; chunked-тело без длины → 411, **до** чтения тела.

**За обратным прокси флаг НЕ ставим** (дефолт — выключено): два CSP-заголовка браузер пересекает
рестриктивно, получается более строгая и трудно отлаживаемая политика, чем любая из двух.

**Пер-IP лимит** на `/api/app-rating` (`server/utils/rateLimit.ts` + `frameRateGuard.ts`) работает
**независимо от флага**, потому что нужен всегда: каждый вызов этих роутов тратит исходящий
`profile`-запрос в портал на проверку фрейм-токена. Ключ лимита — реальный TCP-пир; `X-Forwarded-For`
берётся, **только** если явно выставлен `APP_EDGE_TRUST_XFF=1`.

⚠ **Проверить модель IP тоннеля до перевода в PUBLIC.** Если тоннель платформы терминируется прокси
на самой VM, `socket.remoteAddress` будет одним общим адресом → все клиенты в одном ведре. Худший
случай безопасен (лимит становится глобальным), но лечится без передеплоя кода: если тоннель —
**доверенный** прокси, добавляющий реальный IP последним хопом `X-Forwarded-For`, выставить
`APP_EDGE_TRUST_XFF=1`.

## Артефакты

| Файл | Что делает |
|---|---|
| `deploy/vibecode-deploy.sh` | Идемпотентный деплой: найти сервер по имени → создать, если нет → дождаться `running`+`CONNECTED` → `access-policy=PUBLIC` → `POST /deploy` |
| `.github/workflows/deploy-vibecode.yml` | Тот же скрипт из CI. **Opt-in:** джоба идёт только при repo-переменной `VIBECODE_DEPLOY == 'true'` |

## ⚠ Env, которые запекаются на СБОРКЕ

Маршруты пререндерятся, поэтому весь `runtimeConfig.public` попадает в HTML **на этапе сборки**.
Задать переменную только в рантайме контейнера **недостаточно** — значение останется пустым, и фича
молча выключится. Скрипт это учитывает: он вытаскивает из `ENV_JSON` все ключи `NUXT_PUBLIC_*` и
подставляет их в команду сборки (значения экранируются `shlex.quote`).

| Переменная | Что выключится, если задать только в рантайме |
|---|---|
| `NUXT_PUBLIC_SITE_URL` | `canonical` и `og:url` лендинга |
| `NUXT_PUBLIC_B24_MARKET_CODE` | попап «оцените приложение» |
| `NUXT_PUBLIC_B24_FORM_ID` / `_SECRET` / `_LOADER_SCRIPT` | форма обратной связи в слайдере |
| `NUXT_PUBLIC_COMMIT_SHA` | ссылка на сборку в футере лендинга |

Серверные переменные (`DATABASE_URL`, `APP_EDGE_SECURITY`, `APP_EDGE_TRUST_XFF`, `B24_EXTRA_ZONES`)
читаются из `process.env` в рантайме — их это не касается.

## Разовая настройка

В **Settings → Secrets and variables → Actions**:

| Тип | Имя | Значение |
|---|---|---|
| Secret | `VIBE_KEY` | `vibe_api_...` — персональный ключ, владеющий сервером и биллингом |
| Secret | `APP_ENV_JSON` | JSON-объект env приложения (пример ниже) |
| Variable | `APP_NAME` | имя сервера, например `smart-links` |
| Variable | `PRESTART_CMD` | провижининг Postgres (опционально, см. ниже) |
| Variable | `VIBECODE_DEPLOY` | `true` — включатель workflow |

```json
{
  "APP_EDGE_SECURITY": "1",
  "NUXT_PUBLIC_SITE_URL": "https://app-XXXX.vibecode.bitrix24.tech",
  "NUXT_PUBLIC_B24_MARKET_CODE": "shef.smartlink",
  "DATABASE_URL": "postgres://app:app@127.0.0.1:5432/app"
}
```

`APP_EDGE_SECURITY: "1"` здесь **обязателен** — без него приложение уедет в интернет вообще без CSP
и `frame-ancestors`. `DATABASE_URL` — опционален; без него роуты рейтинга инертны, остальное работает.

`NUXT_PUBLIC_SITE_URL` на первом деплое неизвестен (`appUrl` печатает сам деплой) — поэтому первый
прогон делается без него, а потом `APP_ENV_JSON` дополняется полученным адресом и деплой
повторяется.

### PRESTART_CMD (только если нужен рейтинг)

```
apt-get update && apt-get install -y postgresql && service postgresql start && \
su - postgres -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='app'\" | grep -q 1 || psql -c \"CREATE USER app PASSWORD 'app'\"" && \
su - postgres -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname='app'\" | grep -q 1 || psql -c 'CREATE DATABASE app OWNER app'"
```

Идемпотентно (переживает передеплой). Схему создаёт само приложение на старте
(`server/plugins/migrate.ts`).

## Первый деплой — вручную

```bash
export VIBE_KEY='vibe_api_...'
export APP_NAME='smart-links'
export SOURCE_URL="https://codeload.github.com/bx-shef/smart-links/tar.gz/$(git rev-parse HEAD)"
export ENV_JSON='{"APP_EDGE_SECURITY":"1"}'
./deploy/vibecode-deploy.sh
```

### Чек-лист после первого деплоя

1. `curl <appUrl>/api/health` → `{"status":"ok",...}`.
2. `curl -I <appUrl>/` → есть заголовок `Content-Security-Policy` (нет ⇒ `APP_EDGE_SECURITY` не
   доехал) и в нём `frame-ancestors` с доменами Б24.
3. `<appUrl>/` открывается как лендинг, `<appUrl>/app` — как оболочка приложения.
4. В кабинете Вайбкода **access policy = PUBLIC**. Скрипт пытается выставить её сам, но этот вызов
   намеренно нефатальный — точную форму эндпоинта нужно подтвердить на живом прогоне.
5. Дописать полученный `appUrl` в `APP_ENV_JSON` как `NUXT_PUBLIC_SITE_URL` и передеплоить.
6. В настройках приложения на портале: путь приложения — `<appUrl>/app`, установочный —
   `<appUrl>/install`.
7. Установить приложение на тестовый портал и проверить, что карточка CRM открывает UF-поле
   (проверяет и `frame-ancestors`, и HANDLER-URL сразу).

## Известные ограничения платформы

- 3 сервера на API-ключ, 10 деплоев/мин на сервер.
- **Авто-сон** после часа простоя; первый запрос будит за 30–60 с. Для in-portal-приложения это
  значит подтормаживание при первом открытии карточки после паузы.
- Нет managed-БД: Postgres живёт на той же VM (см. `PRESTART_CMD`).
- Бэкапы — снимок диска, переживает удаление сервера.
