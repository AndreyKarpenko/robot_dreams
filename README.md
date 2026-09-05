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

## Configuration

Zod validates env on boot (`src/config/env.schema.ts` → `ConfigModule.forRoot({ validate })`). A broken variable kills the process before HTTP starts. The Postgres password is **not** an env var: the pool reads `secrets/db_password` on every new connection.

### Variables

| Variable | Required | Default | Source | Meaning |
|---|---|---|---|---|
| `PORT` | no | `3000` | env | HTTP port |
| `DB_URL` | yes | — | **secrets store** (hw-11): password from `secrets/db_password`, URL from the untracked `.env` in both `dev` and `prod` | `postgres://user@host:port/db` — points at the hw-12 database (`shop`); the password inside the URL is ignored |
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

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

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
