<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Database (hw-12)

Main table: **`orders`** (200 000 rows after seeding).

Bring Postgres up — one line, works on a fresh clone with no file edits:

```bash
docker compose up -d --wait
```

Connect — one line:

```bash
docker compose exec -T db psql -U admin -d shop
```

Dev credentials of the local stand live in `docker-compose.yml` (`admin` /
`admin-bootstrap-only` / db `shop`) on purpose: they are not a secret, and a fresh clone
must come up without guessing anything. The *application's* connection string is a
different path — see [Configuration](#configuration).

`./db` is mounted read-only into the container at `/db`, so the SQL scripts run by path:

```bash
docker compose exec -T db psql -U admin -d shop -v ON_ERROR_STOP=1 -f /db/schema.sql   # tables + constraints
docker compose exec -T db psql -U admin -d shop -v ON_ERROR_STOP=1 -f /db/seed.sql     # 200k orders, ends with VACUUM (ANALYZE)
docker compose exec -T db psql -U admin -d shop -c "EXPLAIN (ANALYZE, BUFFERS) $(cat db/queries/q1.sql)"   # before: Seq Scan
docker compose exec -T db psql -U admin -d shop -v ON_ERROR_STOP=1 -f /db/indexes.sql  # indexes
docker compose exec -T db psql -U admin -d shop -c "ANALYZE;"
docker compose exec -T db psql -U admin -d shop -c "EXPLAIN (ANALYZE, BUFFERS) $(cat db/queries/q1.sql)"   # after: Index Scan
```

Repeat the two `EXPLAIN` lines for `q2.sql` and `q3.sql`. Full cycle from a clean volume:
`docker compose down -v && docker compose up -d --wait`, then the scripts in the order
above.

| File | Purpose |
|---|---|
| `db/schema.sql` | 4 tables, 4 foreign keys, `CHECK`/`NOT NULL`; `numeric(12,2)` for money, `timestamptz` for time |
| `db/seed.sql` | skewed data via `generate_series`, 200 000 `orders`, ends with `VACUUM (ANALYZE)` |
| `db/queries/q1..q3.sql` | one API query per file, one statement each |
| `db/indexes.sql` | composite, partial + covering, and expression index |
| `db/OPTIMIZATIONS.md` | `EXPLAIN (ANALYZE, BUFFERS)` before/after for all three, with the numbers |

Measured speed-ups: **50×**, **135×**, **196×** — details in
[`db/OPTIMIZATIONS.md`](db/OPTIMIZATIONS.md).

## TypeORM (hw-13)

The hw-12 schema lives in TypeORM as entities + a real migration. `synchronize` is
**false** (also on the two expression/partial indexes the generator cannot emit).
Money is `integer` minor units (cents), not `float` and not `numeric`.

```bash
docker compose up -d --wait
npm ci
npx tsc --noEmit
npm run build
export DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=admin DB_PASSWORD=admin-bootstrap-only DB_NAME=shop
export SKIP_VAULT=1
npm run migrate          # creates schema
npm run migrate:show     # [X] InitialSchema… and StockBalanceAndJobs…
npm run seed             # 8 users, 10 products, 8 orders, 16 order_items
npm run demo:nplus1
npm run report
```

`migrate`, `migrate:show`, `migrate:revert`, `seed`, `demo:nplus1`, `demo:race`,
`demo:workers`, `demo:retry`, and `report` all go through `bash scripts/with-secrets.sh dev …`.
Locally that loads Infisical; the grader sets `SKIP_VAULT=1` so the wrapper `exec`s the
command with env already in the process.

### N+1 (order → items → product)

Measured by `npm run demo:nplus1` (`logging: ['query']` + `QueryCountLogger`).

| Strategy | Queries |
|---|---|
| naive (query in a loop) | **25** (N = 8 orders: 1 + 8 item loads + 16 product loads) |
| `leftJoinAndSelect` | **1** (same for N = 3 and N = 8) |
| `relationLoadStrategy: 'query'` | **4** (≤ 1 + 2 × 2 levels = 5; does not grow with N) |

### Repository vs QueryBuilder

`find()` / Repository is for loading entities you will mutate or return as objects
(by id, unique email, a short filter). `createQueryBuilder().getRawMany()` is for
reporting: aggregates, `GROUP BY`, and joins where hydrating `Order` graphs would be
the wrong shape. `npm run report` is seller revenue (`SUM(quantity * unit_price)` of
paid/shipped orders) — that cannot be expressed as `find()`.

### onDelete

- **RESTRICT** on `products.seller_id`, `orders.buyer_id`, `order_items.product_id`:
  deleting a user or a product must not rewrite sales history.
- **CASCADE** on `order_items.order_id`: line items are part of the order; removing
  the order removes its lines.

Expression unique index `users_email_lower_idx` and partial covering
`orders_queue_recent_idx` are created in the migration (`synchronize: false` on the
matching `@Index` so TypeORM does not try to emit a plain column index instead).

### Seed idempotency

Second `npm run seed` is a no-op for rows that already exist (users/products upserted
by email/name; each seed order upserted by buyer+status+line items, so an interrupted
first run is completed on the next run instead of left half-filled). Counts after the
second run:

```bash
docker compose exec -T db psql -U admin -d shop -c "
SELECT 'users' AS t, count(*) FROM users
UNION ALL SELECT 'products', count(*) FROM products
UNION ALL SELECT 'orders', count(*) FROM orders
UNION ALL SELECT 'order_items', count(*) FROM order_items;"
```

Expected: users 8, products 10, orders 8, order_items 16. Buyers get a surplus
balance (`10000000` cents); every product starts with `stock = 100`. Those two
columns exist so checkout can fail on stock, not on money.

## Конкурентність

Checkout (`src/checkout.ts`) виконується в одній транзакції на одному клієнті
пулу (`dataSource.transaction`): атомарний декремент stock, атомарне списання
балансу, INSERT замовлення + рядка, INSERT задачі `jobs` на лист/чек. Нестача
товару або коштів кидає помилку — TypeORM відкочує транзакцію цілком, замовлень-
«сиріт» немає.

**Чому atomic `UPDATE … RETURNING`, а не `SELECT … FOR UPDATE`.** Checkout робить
`UPDATE products SET stock = stock - $n WHERE id = $id AND stock >= $n RETURNING`.
Предикат і запис — один statement, тож між «перевірив stock» і «зменшив» немає
вікна для іншої сесії. Нуль рядків = товару немає: це і перевірка, і лок.
`SELECT … FOR UPDATE` теж коректний у тій самій транзакції, але це два round-trip
(лок, потім UPDATE) за ту саму ізоляцію. Баланс списано тим самим патерном.

**Чому retry ловить лише `40001` і `40P01`.** `40001` — `serialization_failure`
(зіткнення знімків REPEATABLE READ / SERIALIZABLE). `40P01` — `deadlock_detected`.
Обидва коди тимчасові: інша сесія вже закомітила або відкотилась, тому повтор
*цілої* транзакції разом із читаннями сходиться. Інші SQLSTATE (CHECK, UNIQUE,
мережа) не «спробуй ще раз»: ретрай зациклить сталу помилку або сховає баг.
Повтор лише UPDATE після старого SELECT — той самий lost update, тільки довше.

### Numbers from a local run

| Demo | Result |
|---|---|
| `npm run demo:race` | 50 спроб, **10** успішних, фінальний stock **0**, рядків із відʼємним stock **0** |
| `npm run demo:workers` | 4 воркери, 26 задач (10 `send_receipt` після race + 16 `demo_work`), розподіл 6 / 7 / 7 / 6, оброблено двічі: **0**, **968 ms** проти **3120 ms** послідовно |
| `npm run demo:retry` | піймано **40001**, retries **1**, фінальний баланс **100** (= 2 × 50) |

## Data layer ops

Застосунок ходить у `shop` через **PgBouncer** (`127.0.0.1:6432`), не в Postgres напряму (`:5432`). Пулер у `transaction` mode: серверний конект зайнятий лише поки відкрита транзакція, тому десятки інстансів API (#28) ділять `default_pool_size = 10`, а не тримають по довгому backend-процесу на кожен HTTP-клієнт. Ціна така: сесійний стан не переживає `COMMIT`. Ламаються щонайменше named prepared statements (наступний запит може потрапити на інший backend — тому в `pgbouncer.ini` стоїть `max_prepared_statements = 200`), сесійні `SET` / `search_path`, і `LISTEN/NOTIFY` (підписка прив’язана до конекта, який після транзакції віддають іншому клієнту). Те саме з тимчасовими таблицями й курсорами `WITH HOLD`.

Підняти стек, бекап, відновитись:

```bash
docker compose up -d --wait
export DATABASE_URL=postgres://admin:admin-bootstrap-only@127.0.0.1:6432/shop
export SKIP_VAULT=1
bash scripts/with-secrets.sh dev bash scripts/backup.sh          # → backups/shop-YYYY-MM-DD.dump
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh  # scratch Postgres, друкує MATCH
```

Розклад нічного дампу — [`backup.cron`](backup.cron). Протокол drill-у (RTO/RPO) — [`RESTORE-DRILL.md`](RESTORE-DRILL.md). Міграції TypeORM лишайте на `:5432`: DDL через transaction pooling часто падає.

## Grading

```bash
docker compose up -d --wait
export BROKER_URL=amqp://app:app@127.0.0.1:5672
export DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=admin DB_PASSWORD=admin-bootstrap-only DB_NAME=shop
export SKIP_VAULT=1
npm ci
npm run build
npm run migrate
npm run demo:outbox
npm run demo:crash-write
npm run demo:crash-relay
```

```bash
docker compose up -d --wait
export BROKER_URL=amqp://app:app@127.0.0.1:5672
export DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=admin DB_PASSWORD=admin-bootstrap-only DB_NAME=shop
export SKIP_VAULT=1
npm ci
npm run demo:publish
npm run demo:dlq
npm run demo:duplicate
```

```bash
docker compose up -d --wait
export DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=admin DB_PASSWORD=admin-bootstrap-only DB_NAME=shop
export SKIP_VAULT=1    # у грейдера немає доступу до сховища
npm ci
npx tsc --noEmit
npm run build
npm run migrate
npm run seed
npm run demo:race
npm run demo:workers
npm run demo:retry
```

```bash
docker compose up -d --wait
export DATABASE_URL=postgres://admin:admin-bootstrap-only@127.0.0.1:6432/shop
export SKIP_VAULT=1    # у грейдера немає доступу до сховища
bash scripts/with-secrets.sh dev bash scripts/backup.sh
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
```

`backup.sh` і `restore-drill.sh` читають `DATABASE_URL` з оточення. Обгортка з `SKIP_VAULT=1` просто виконує команду; без `DATABASE_URL` голий `bash scripts/backup.sh` падає з `DATABASE_URL: unbound variable`.

## Configuration

Zod validates env on boot (`src/config/env.schema.ts` → `ConfigModule.forRoot({ validate })`). A broken variable kills the process before HTTP starts. The Postgres password is **not** an env var: the pool reads `secrets/db_password` on every new connection.

### Variables

| Variable | Required | Default | Source | Meaning |
|---|---|---|---|---|
| `PORT` | no | `3000` | env | HTTP port |
| `DB_URL` | yes | — | **secrets store** (hw-11): password from `secrets/db_password`, URL from the untracked `.env` in both `dev` and `prod` | `postgres://user@host:port/db` — points at the hw-12 database (`shop`); the password inside the URL is ignored |
| `BROKER_URL` | no | — | **secrets store** (hw-11), next to the database URL. Empty means the API boots without publishing | `amqp://user:pass@host:5672` — AMQP port of the hw-19 RabbitMQ. `15672` is the management UI, not AMQP |
| `LOG_LEVEL` | no | `info` | env | `debug` \| `info` \| `warn` \| `error` |
| `TIMEOUT_MS` | no | `5000` | env | outbound timeout, ms |

`DB_URL` is never committed with a real value: `.env.example` carries the contract with a
fake password, `.env` is gitignored, and the only credential on disk is
`secrets/db_password`, which `.gitignore` and `.dockerignore` both exclude. Sync check:
`npm run check:env`.

Two separate paths, on purpose:

- **App → database**: secret comes from the store (`secrets/db_password`), never from an env file.
- **Grader → local stand**: dev credentials in `docker-compose.yml`, so a fresh clone boots.

### How to run the app

```bash
cp .env.example .env
cp secrets/db_password.example secrets/db_password
docker compose up -d --wait
npm install
npm run start
```

- `GET /health` — `{ status, uptime }` (process uptime in seconds)
- `GET /db` — query through `pg.Pool` (needs Postgres)

### Password rotation (no app restart)

Order in `rotate.sh` is required: `ALTER ROLE` → update the file → `pg_terminate_backend`.

```bash
# 1. App is already running (npm run start). Remember uptime:
curl -s localhost:3000/health

# 2. Rotate
bash rotate.sh

# 3. DB still works; uptime must be higher than before (same process)
curl -s localhost:3000/db
curl -s localhost:3000/health
```

After `docker compose down -v` Postgres is re-initialized with `app-v1-password`. If the file still has a rotated value, write it back:

```bash
cp secrets/db_password.example secrets/db_password
```

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Тестування (hw-16)

Docker має бути запущений: integration, e2e і provider verification піднімають `postgres:16-alpine` через `@testcontainers/postgresql`. `DATABASE_URL` для тестів видає контейнер (`container.getConnectionUri()`) — сховище секретів для цього не потрібне.

```bash
npm ci
npx tsc --noEmit
npm run test                 # unit
npm run test:integration     # репозиторії проти Postgres
npm run test:e2e             # Nest + supertest, create → read + 400/404
npm run test:contract        # consumer Pact → pacts/*.json
npm run verify:provider      # справжній застосунок проти контракту
```

`pacts/` генерує `npm run test:contract` і лежить у репо, щоб `verify:provider` працював на свіжому клоні без попереднього consumer-прогону.

### Ізоляція

Інтеграційні тести відкривають `BEGIN` у `beforeEach` і роблять `ROLLBACK` у `afterEach`. Репозиторії приймають `Queryable` (Pool або клієнт з `query()`), тож у тесті їм віддається клієнт відкритої транзакції, а не пул. Після ROLLBACK unique/FK знову вільні, тому `npm run test:integration && npm run test:integration` зелений без ручної чистки БД. Схему міграції накатуємо один раз на контейнер; identity-послідовності після ROLLBACK не відкочуються — билдери завжди генерують унікальні email/name.

### Pact Broker локально

```bash
docker compose up -d --wait   # брокер на http://127.0.0.1:9292, healthcheck на 127.0.0.1
```

Локально URL і токен брокера приїжджають зі сховища ДЗ #11: `bash scripts/with-secrets.sh dev npm run verify:provider`. Якщо `SKIP_VAULT=1`, обгортка просто виконує команду з уже заданим оточенням. Грейдер (і CI) передають змінні напряму: `PACT_BROKER_URL=http://127.0.0.1:9292 npm run verify:provider`. Код читає лише `process.env.PACT_BROKER_URL` / `PACT_BROKER_TOKEN`. Дефолт `http://127.0.0.1:9292` — адреса compose, не секрет. Без `PACT_BROKER_URL` верифікація йде по локальному `pacts/*.json`.

Consumer `MarketplaceWeb` / provider `MarketplaceAPI`, версії `1.0.0`. Локальний гейт (порядок обовʼязковий; крок із тегом `prod` пропускати не можна):

```bash
docker compose up -d --wait

curl -sS -o /tmp/pact-publish.json -w "%{http_code}\n" -X PUT \
  -H "Content-Type: application/json" \
  --data-binary @pacts/MarketplaceWeb-MarketplaceAPI.json \
  http://127.0.0.1:9292/pacts/provider/MarketplaceAPI/consumer/MarketplaceWeb/version/1.0.0
# 201

PACT_BROKER_URL=http://127.0.0.1:9292 npm run verify:provider

curl -sS "http://127.0.0.1:9292/can-i-deploy?pacticipant=MarketplaceWeb&version=1.0.0&to=prod"
```

До тега `prod` брокер чесно каже unknown:

```json
{
  "summary": {
    "deployable": null,
    "reason": "There is no verified pact between version 1.0.0 of MarketplaceWeb and the latest version of MarketplaceAPI with tag prod (no such version exists)",
    "success": 0,
    "failed": 0,
    "unknown": 1
  }
}
```

Повний вивід:

```json
{"summary":{"deployable":null,"reason":"There is no verified pact between version 1.0.0 of MarketplaceWeb and the latest version of MarketplaceAPI with tag prod (no such version exists)","success":0,"failed":0,"unknown":1},"notices":[{"type":"error","text":"There is no verified pact between version 1.0.0 of MarketplaceWeb and the latest version of MarketplaceAPI with tag prod (no such version exists)"}],"matrix":[{"consumer":{"name":"MarketplaceWeb","version":{"number":"1.0.0","branch":null,"branches":[],"branchVersions":[],"environments":[],"_links":{"self":{"href":"http://127.0.0.1:9292/pacticipants/MarketplaceWeb/versions/1.0.0"}},"tags":[]},"_links":{"self":{"href":"http://127.0.0.1:9292/pacticipants/MarketplaceWeb"}}},"provider":{"name":"MarketplaceAPI","version":null,"_links":{"self":{"href":"http://127.0.0.1:9292/pacticipants/MarketplaceAPI"}}},"pact":{"createdAt":"2026-09-18T14:01:13+00:00","_links":{"self":{"href":"http://127.0.0.1:9292/pacts/provider/MarketplaceAPI/consumer/MarketplaceWeb/version/1.0.0"}}},"verificationResult":null}]}
```

Тег ставиться на **версію провайдера**, ту саму, що `providerVersion` у Verifier:

```bash
curl -sS -o /dev/stderr -w "%{http_code}\n" -X PUT \
  -H "Content-Type: application/json" \
  -d '{}' \
  http://127.0.0.1:9292/pacticipants/MarketplaceAPI/versions/1.0.0/tags/prod
# 201

curl -sS "http://127.0.0.1:9292/can-i-deploy?pacticipant=MarketplaceWeb&version=1.0.0&to=prod"
```

Після тега гейт відкривається:

```json
{
  "summary": {
    "deployable": true,
    "reason": "All required verification results are published and successful",
    "success": 1,
    "failed": 0,
    "unknown": 0
  }
}
```

Повний вивід:

```json
{"summary":{"deployable":true,"reason":"All required verification results are published and successful","success":1,"failed":0,"unknown":0},"notices":[{"type":"success","text":"All required verification results are published and successful"}],"matrix":[{"consumer":{"name":"MarketplaceWeb","version":{"number":"1.0.0","branch":null,"branches":[],"branchVersions":[],"environments":[],"_links":{"self":{"href":"http://127.0.0.1:9292/pacticipants/MarketplaceWeb/versions/1.0.0"}},"tags":[]},"_links":{"self":{"href":"http://127.0.0.1:9292/pacticipants/MarketplaceWeb"}}},"provider":{"name":"MarketplaceAPI","version":{"number":"1.0.0","branch":"prod","branches":[{"name":"prod","latest":true,"_links":{"self":{"title":"Branch version","name":"prod","href":"http://127.0.0.1:9292/pacticipants/MarketplaceAPI/branches/prod/versions/1.0.0"}}}],"branchVersions":[{"name":"prod","latest":true,"_links":{"self":{"title":"Branch version","name":"prod","href":"http://127.0.0.1:9292/pacticipants/MarketplaceAPI/branches/prod/versions/1.0.0"}}}],"environments":[],"_links":{"self":{"href":"http://127.0.0.1:9292/pacticipants/MarketplaceAPI/versions/1.0.0"}},"tags":[{"name":"prod","latest":true,"_links":{"self":{"href":"http://127.0.0.1:9292/pacticipants/MarketplaceAPI/versions/1.0.0/tags/prod"}}}]},"_links":{"self":{"href":"http://127.0.0.1:9292/pacticipants/MarketplaceAPI"}}},"pact":{"createdAt":"2026-09-18T14:01:13+00:00","_links":{"self":{"href":"http://127.0.0.1:9292/pacts/provider/MarketplaceAPI/consumer/MarketplaceWeb/version/1.0.0"}}},"verificationResult":{"success":true,"verifiedAt":"2026-09-18T14:01:17+00:00","_links":{"self":{"href":"http://127.0.0.1:9292/pacts/provider/MarketplaceAPI/consumer/MarketplaceWeb/pact-version/f5a5bd1abf4dc77b7953da7ce0f375be0fd9c930/metadata/Y3ZuPTEuMC4w/verification-results/200"}}}}]}
```

У CI job `contract` робить publish → verify (`publishVerificationResult: true`) → can-i-deploy. `PACT_BROKER_URL` / `PACT_BROKER_TOKEN` — GitHub secrets; локальний compose підставляється, якщо секрет порожній.

## Realtime (hw-18)

Зміна статусу замовлення публікує подію `order.status` з `OrdersService` (після `COMMIT`) в одну шину `OrderEventsService`. Номер події — це `orders.event_seq` в тій самій транзакції, що й статус; рядок лишається в `order_status_events`. WebSocket-gateway і `GET /orders/:id/events` пускають лише власника за підписаним `stream_token` (HMAC, секрет `STREAM_TOKEN_SECRET`). Подія йде тільки в кімнату `orders:<id>`. SSE — `text/event-stream`, поле `id:`, реплей з логу за `Last-Event-ID`.

Збірка як на лекції: `tsc` через `nest build`, далі `node dist`. `tsx` не емітить метадані декораторів, тож gateway з нього не підніметься. `npm run start` — це `npm run build && node dist/main.js`.

```bash
docker compose up -d --wait
cp .env.example .env
cp secrets/db_password.example secrets/db_password
export DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=admin DB_PASSWORD=admin-bootstrap-only DB_NAME=shop
export SKIP_VAULT=1
npm ci
npm run build
npm run migrate
npm run seed
docker compose exec -T db psql -U admin -d shop -v ON_ERROR_STOP=1 -c "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;"
export DEFAULT_BUYER_ID="$(docker compose exec -T db psql -U admin -d shop -tAc "SELECT id FROM users WHERE email = 'buyer.daria@shop.test'")"
export STREAM_TOKEN_SECRET="$(openssl rand -hex 32)"
npm run start
```

`DEFAULT_BUYER_ID` має бути в оточенні процесу API: `POST /orders` пише замовлення на цього покупця і повертає `stream_token`, підписаний `STREAM_TOKEN_SECRET`. Сокет (`handshake.auth.token`) і SSE (`Authorization: Bearer` або `?token=`) приймають лише цей токен. Після міграції `order_status_events` повтори GRANT, якщо `app_user` отримував права до нової таблиці:

```bash
docker compose exec -T db psql -U admin -d shop -v ON_ERROR_STOP=1 -c "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;"
```

Зміна статусу (кожен успішний виклик — нова подія, навіть якщо рядок статусу той самий). Дозволені значення: `created`, `paid`, `shipped`, `cancelled`.

```bash
ORDER_JSON=$(curl -s -X POST http://localhost:3000/orders \
  -H 'content-type: application/json' \
  -d '{"items":[{"product_id":1,"quantity":1}]}')
ORDER_ID=$(printf '%s' "$ORDER_JSON" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).id")
TOKEN=$(printf '%s' "$ORDER_JSON" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).stream_token")

curl -s -X PATCH "http://localhost:3000/orders/${ORDER_ID}/status" \
  -H 'content-type: application/json' \
  -d '{"status":"paid"}'

curl -sN --max-time 2 -D - -o /dev/null \
  -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/orders/${ORDER_ID}/events" | grep -i '^content-type'

for s in paid shipped cancelled created; do
  curl -s -X PATCH "http://localhost:3000/orders/${ORDER_ID}/status" \
    -H 'content-type: application/json' \
    -d "{\"status\":\"$s\"}"
done

curl -sN --max-time 2 -H "Authorization: Bearer $TOKEN" -H 'Last-Event-ID: 3' \
  "http://localhost:3000/orders/${ORDER_ID}/events" | grep '^id:' | head -1
```

`id` не скидається після рестарту процесу: наступна зміна статусу бере `event_seq + 1` з рядка замовлення. Клієнт з `Last-Event-ID: 5` отримує події з `id` > 5, у тому числі ті, що вже лежать у `order_status_events`.

Ізоляція кімнат. Скрипт сам створює два замовлення, підключає клієнтів, чекає ack від `join` і лише потім міняє статус замовлення A. `--same-room` — той самий код, друга кімната теж A.

```bash
node scripts/realtime-demo.mjs; echo "exit=$?"
node scripts/realtime-demo.mjs --same-room; echo "exit=$?"
```

Redis-адаптер для одного інстанса не потрібен. Номери подій і реплей SSE спільні для інстансів, бо живуть у Postgres. Кімнати Socket.IO і жива шина лишаються в памʼяті кожного процесу, тож WebSocket-клієнт на іншому інстансі не побачить `order.status` — це лікується Redis-адаптером Socket.IO і спільним pub/sub для шини (лекція, крок 7).

## Async-події через RabbitMQ

Брокер — RabbitMQ **4.2** (гілка LTS, комерційна підтримка до 30.06.2030). Образ `rabbitmq:4.2-management`: AMQP на `5672`, вебморда на `15672`. Черги — quorum (`x-queue-type: quorum`). Класичне дзеркалювання (`ha-mode`) у 4.0 прибрали.

Топологію оголошує споживач і бутстрап `BrokerBootstrap`, не продюсер. Topic-exchange `shop.events`, черга `shop.orders.placed`, binding на routing key `order.placed`. Поруч — direct exchange `shop.events.dlx` і черга `shop.orders.placed.dlq`; на робочій черзі аргумент `x-dead-letter-exchange`. Продюсер цього не бачить: він публікує в exchange і не знає, хто слухає.

Чергу поза демо читає API: `BrokerModule` після оголошення топології тримає споживача, поки живий процес. Той самий споживач окремим процесом — `npm run consume:order-placed`. Обидва пишуть у `order_placed_effects` через `ON CONFLICT`, тож друга репліка не подвоює ефект. Споживач API ходить у базу пулом застосунку. Міграція дає `app_user` права `SELECT`, `INSERT`, `UPDATE`, `DELETE` на `order_placed_effects` і `order_placed_deliveries`.

Аргументи черги незмінні. Демо знімає DLQ і exchange перед повторним оголошенням, інакше зміна DLX дає `406 PRECONDITION_FAILED`. Робочу чергу `shop.orders.placed` воно не видаляє: на ній сидить споживач живого API, і `queue.delete` скасував би його разом із повідомленнями. Демо і живий споживач ділять цю чергу, тож числа нижче зняті, коли API і `consume:order-placed` зупинені.

Подія `order.placed` виходить із оформлення замовлення після `COMMIT`: з `checkout` і з `POST /orders`. Тіло — контракт `{ eventId, type, occurredAt, data }`, не ORM-сутність. `eventId` стабільний: `order.placed:<orderId>`. Публікація йде одним confirm-каналом на процес (`createConfirmChannel` + `waitForConfirms`; канал не закривається після події) і з `mandatory: true`. Позитивний confirm без binding означає лише «брокер коректно викинув повідомлення», тому `basic.return` валить виклик. Якщо `BROKER_URL` не заданий, публікація не відбувається і споживач не стартує: API піднімається без брокера.

Споживач працює з `noAck: false` і викликає `ack` після ефекту. Отруєне тіло (`poison: true` у демо DLQ) іде в `channel.reject(message, false)`, не в `nack`. На RabbitMQ 4.3 `nack(requeue=true)` не збільшує delivery-count, тож такий цикл нічим не обмежений. `reject` без requeue дає причину `rejected`. Її демо читає з `x-first-death-reason` (запасний шлях — перший запис `x-death`).

Ефект ідемпотентний сам по собі: `INSERT INTO order_placed_effects (event_id, order_id) … ON CONFLICT (event_id) DO NOTHING`. Ідемпотентність тут — властивість операції. `eventId` — природний ключ цієї операції, а не окремий ключ ідемпотентності, яким обгортають неідемпотентний `qty = qty - 1`. Рядок лежить у Postgres, тож переживає рестарт процесу і спільний для двох реплік. Таблиця `order_placed_deliveries` лише рахує доставки; вона не є позначкою «вже оброблено» і не блокує ефект.

`demo:duplicate` піднімає споживача окремим процесом. Той записує ефект і одразу робить `process.kill(process.pid, 'SIGKILL')` — до `ack`. `channel.close()` для цього не годиться: це коректне завершення. Тут процес зникає, ОС закриває сокет, брокер бачить обрив і повертає непідтверджене повідомлення. Другий споживач отримує той самий `eventId`, `INSERT` нічого не змінює, і лише тоді шле `ack`.

Позначка в `processed_messages` і ефект у `order_placed_effects` комітяться однією транзакцією. Публікація `order.placed` для оформлення замовлення пишеться в outbox у тій самій транзакції, що й саме замовлення; relay виносить рядок у RabbitMQ вже після `COMMIT`. Деталі й числа прогонів — у секції «Outbox та ідемпотентність».

`dead-letter-strategy: at-least-once` без `overflow: reject-publish` мовчки не вмикається. Політика приймається і видна в `effective_policy_definition`, а брокер лишається на at-most-once і пише про це лише в лог. Для цього ДЗ лишив дефолт.

prefetch=10, бо ефект — один INSERT, і на прогоні `demo:publish` пʼять таких INSERT зайняли 4 мс сумарно: 10 × 1 мс менше за `consumer_timeout` у 30 хвилин; дефолт брокера 0 означає без ліміту, і перший споживач забрав би всю чергу.

Це at-least-once доставка, не exactly-once. Confirm і ручний ack не дають третього варіанта: підтвердив рано — повідомлення зникне разом із процесом, підтвердив пізно — брокер пришле його ще раз. Exactly-once на рівні доставки немає ні в RabbitMQ, ні в будь-кого іншого. Результат один, бо повторна доставка того самого `eventId` впирається в `ON CONFLICT DO NOTHING` і ефект не подвоюється. `demo:duplicate` це показує: дві доставки, один ефект.

Прогін на локальному стенді (exit 0):

| Демо | Вивід |
|---|---|
| `demo:publish` | `published=5` `delivered=5` `effect=5` `acked=5` `dlq=0` `prefetch=10` (`effect_ms=4`) |
| `demo:dlq` | `rejected=1` `work=0` `dlq=1` `dlq-reason=rejected` `effect=0` |
| `demo:duplicate` | `deliveries=2` `effect=1` `skipped=1` |

`BROKER_URL` лежить у сховищі ДЗ #11 поруч із підключенням до бази. Нового env-файла немає. Грейдер ставить `SKIP_VAULT=1` і бере `amqp://app:app@127.0.0.1:5672` з `docker-compose.yml`.

## Outbox та ідемпотентність

Оформлення замовлення (`checkout` і `POST /orders`) пише бізнес-рядок і рядок `outbox` в одному `dataSource.transaction` / `pool.connect()`. У транзакції немає `publish`: брокер не вміє відкочуватись. У `payload` лежить контракт `toOrderPlacedEvent`, а не ORM-сутність. Relay забирає рядки `SELECT … WHERE published_at IS NULL ORDER BY created_at, id FOR UPDATE SKIP LOCKED`, публікує в RabbitMQ і лише потім робить `UPDATE published_at`. API, коли заданий `BROKER_URL`, крутить той самий цикл кожні 500 мс.

Імена колонок — snake_case (`aggregate_type`, `aggregate_id`, `published_at`). Канон Debezium Outbox Event Router — без підкреслень, і `route.by.field` за замовчуванням читає `aggregatetype`. Перехід на CDC лишає консюмерів: у конфігурації роутера треба виставити `route.by.field=aggregate_type` і `table.field.event.key=aggregate_id`.

Ідемпотентність у три шари. На краю API заголовок `Idempotency-Key` зберігається як намір (`idempotency_keys.key → order_id`), без хеша тіла: два легітимні однакові замовлення — це два ключі. У консюмера ефект — `INSERT … ON CONFLICT (event_id) DO NOTHING`, а позначка `processed_messages (message_id, consumer)` комітиться разом із цим ефектом. `order_placed_deliveries` лише рахує доставки, включно з дублями.

`ORDER BY created_at, id` задає лише порядок вибірки. `SKIP LOCKED` роздає рядки різним воркерам, тож глобального порядку доставки немає. Окремого ключа партиціонування тут немає.

Опубліковані рядки з часом треба прибирати, інакше таблиця розпухає і vacuum починає гальмувати навіть частковий індекс `WHERE published_at IS NULL` (у ньому лишаються лише невинесені рядки, але heap росте): `DELETE FROM outbox WHERE published_at < now() - interval '7 days'`.

`demo:crash-relay` убиває relay винятком усередині тієї самої транзакції, рівно після `publish` і до `UPDATE published_at` (змодельований обрив, як крок 8 на лекції, не `kill -9`). TypeORM відкочує транзакцію, `published_at` лишається `NULL`, а повідомлення вже в черзі. Наступний прохід публікує його вдруге.

Чому не можна поміняти місцями `publish` і `UPDATE published_at`. Якщо спершу позначити рядок винесеним, а потім публікувати, падіння між цими кроками залишає `published_at` заповненим і порожню чергу. Relay цей рядок більше не візьме. Дубль лікується `ON CONFLICT` на консюмері; втрачене повідомлення не лікується нічим. Помилка `publish` теж не доводить, що брокеру нічого не дісталось: могла загубитись лише відповідь. Тому відкат позначки після помилки публікації не прибирає подію, яка вже могла лягти в чергу, і дедуп на консюмері потрібен у будь-якому разі.

Прогін на локальному стенді (усі три з exit 0):

| Демо | Вивід |
|---|---|
| `demo:outbox` | `requests=2` `orders=1` `outbox=1` `published=1` `deliveries=1` `effect=1` `processed=1` |
| `demo:crash-write` | `write-failed=1` `orders=0` `outbox=0` `published=0` `deliveries=0` `effect=0` |
| `demo:crash-relay` | `published=2` `deliveries=2` `applied=1` `effect=1` `processed=1` |

## Trade-offs: WebSocket vs SSE

Для нотифікацій про статус замовлення в проді я лишив би SSE. Покупець лише слухає: потік сервер → клієнт лягає на звичайний HTTP, а `Last-Event-ID` повертає пропущені події після обриву. WebSocket лишив би там, де той самий екран ще й шле команди (join кімнати) одним зʼєднанням — для чистих нотифікацій upgrade і sticky sessions зайві.

| Критерій | WebSocket | SSE |
| --- | --- | --- |
| Напрям каналу | двосторонній: клієнт шле `join`, сервер пушить `order.status` | лише сервер → клієнт; команди лишаються звичайним HTTP |
| Реконект / відновлення | socket.io піднімає сокет сам (події реконекту — на manager), пропущені статуси без окремого буфера не доїжджають | браузер шле `Last-Event-ID`, сервер віддає події з `id` > N з `order_status_events`; `retry:` задає паузу |
| Вимоги до інфраструктури | HTTP Upgrade, sticky sessions або Redis-адаптер, інакше кімнати не спільні між інстансами | звичайний довгий GET, проксі без окремої підтримки сокетів |
| Ціна на подію | постійний сокет і heartbeat навіть коли статусів немає | одне HTTP-зʼєднання, подія — кілька текстових рядків `id` / `event` / `data` |

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
