# Marketplace API

Course project, homework 1. OpenAPI contract plus runtime validation.

**Contract variant: B** — `express-openapi-validator` checks requests and responses against `openapi/openapi.yaml`. Validation errors are returned as `application/problem+json`. NestJS modules in `src/` are a later-course scaffold and are not used by `npm start`.

## Setup

```bash
npm install
```

## Run

```bash
npm start
```

Listens on `http://localhost:3000`. Seeded products: id `1` (Notebook, `1299` cents) and `2` (Pen, `199` cents).

## Spec

- `openapi/openapi.yaml` — OpenAPI 3.0.3, resources `/products` and `/orders`
- Cursor pagination on list operations (`limit`, `cursor`, `items`, `next_cursor`)
- `Idempotency-Key` required on `POST /orders`
- Same key + same body → original `201` with `Idempotency-Replay: true`
- Same key + different body → `422` `application/problem+json`
- All 4xx responses use `application/problem+json` (`Problem` schema)

Implemented routes (in-memory): `GET /products`, `GET /products/{id}`, `GET /orders`, `POST /orders`, `GET /orders/{id}`.

## Acceptance checks

Run from the repository root after `npm install`.

### Spec is valid

```bash
npx @redocly/cli lint openapi/openapi.yaml
```

Exit code 0. Warnings are allowed, errors are not.

### Spec size (operations, resources, Idempotency-Key)

```bash
npx @redocly/cli bundle openapi/openapi.yaml -o spec.json

node -e "const s=require('./spec.json'),M=['get','post','put','patch','delete'];\
const ops=Object.entries(s.paths).flatMap(([p,v])=>Object.keys(v).filter(m=>M.includes(m)).map(m=>[p,m]));\
const idem=ops.flatMap(([p,m])=>s.paths[p][m].parameters??[]).find(x=>x.in==='header'&&/idempotency-key/i.test(x.name));\
console.log('операцій:',ops.length,'· ресурсів:',new Set(Object.keys(s.paths).map(p=>p.split('/')[1])).size);\
console.log('Idempotency-Key: required =',idem?.required,'· опис, символів =',(idem?.description??'').trim().length)"
```

Expected: operations ≥ 5, resources ≥ 2, Idempotency-Key `required = true`, description length ≥ 40.

### Idempotency-Key, cursor pagination, problem+json

```bash
grep -c 'Idempotency-Key' openapi/openapi.yaml
grep -c 'next_cursor' openapi/openapi.yaml
grep -c 'application/problem+json' openapi/openapi.yaml
```

Expected: first count ≥ 1, `next_cursor` ≥ 1, `application/problem+json` ≥ 2.

### Variant B — runtime validation

Start the server with `npm start`, then:

```bash
# 400, Content-Type: application/problem+json
# detail: request/headers must have required property 'idempotency-key'
curl -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"product_id":1,"quantity":1}]}'

# 400, detail: request/body/items must NOT have fewer than 1 items
curl -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: k1' \
  -d '{"items":[]}'

# 201
curl -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: k1' \
  -d '{"items":[{"product_id":1,"quantity":1}]}'
```

### Extra challenge — Idempotency-Key semantics

After the successful `201` above:

```bash
# 201, header Idempotency-Replay: true, same order id
curl -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: k1' \
  -d '{"items":[{"product_id":1,"quantity":1}]}'

# 422, Content-Type: application/problem+json
curl -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: k1' \
  -d '{"items":[{"product_id":2,"quantity":1}]}'
```

## Nest scaffold (not used for this homework)

```bash
npm run start:nest
```
