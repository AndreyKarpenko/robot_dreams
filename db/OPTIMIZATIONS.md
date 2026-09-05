# Query optimizations

Three real Marketplace API queries, measured before and after `db/indexes.sql`.

**Environment.** Postgres 16 (`postgres:16-alpine`) in Docker on macOS (Apple Silicon,
Docker Desktop), default `postgresql.conf` — `shared_buffers=128MB`,
`work_mem=4MB`, `random_page_cost=4`, parallel workers enabled.

**Dataset** (`db/seed.sql`, main table `orders`):

| Table | Rows | Skew |
|---|---|---|
| `users` | 50 000 | — |
| `products` | 50 000 | sellers follow a power curve (top 0.2% of sellers hold ~12% of the catalogue) |
| `orders` | **200 000** | buyers follow the same curve; status is `paid` 62% / `shipped` 25% / `created` 9% / `cancelled` 4% |
| `order_items` | ~400 000 | 1–3 lines per order |

**Measurement order** — identical to the grading order:

```
docker compose down -v && docker compose up -d --wait
schema.sql → seed.sql → EXPLAIN "before" → indexes.sql → ANALYZE → EXPLAIN "after"
```

Every plan below is the **second** run of that query, so both the "before" and the
"after" numbers are measured against a warm cache and the comparison is fair
(`shared hit` in both, no `read`). Because `seed.sql` uses `random()`, re-running
it shifts the absolute milliseconds — the order of magnitude is what matters.

Summary of what the three indexes bought:

| Query | Execution time | Speed-up | Buffers | Plan change |
|---|---|---|---|---|
| q1 | 6.652 ms → **0.133 ms** | **50×** | 3304 → 26 | Parallel Seq Scan + Sort + Gather Merge → Index Scan |
| q2 | 7.432 ms → **0.055 ms** | **135×** | 3304 → 3 | Parallel Seq Scan + top-N heapsort → Index Only Scan, `Heap Fetches: 0` |
| q3 | 11.552 ms → **0.059 ms** | **196×** | 468 → 4 | Seq Scan → Index Scan on the expression |

---

## q1 — buyer's own order history, last 6 months, first page

`GET /users/42/orders?since=180d&limit=20` — the "My orders" screen.

```sql
SELECT id, status, total, created_at
FROM orders
WHERE buyer_id = 42
  AND created_at >= now() - interval '180 days'
ORDER BY created_at DESC
LIMIT 20;
```

Index: `orders_buyer_created_idx ON orders (buyer_id, created_at DESC)`.

### Before

```
                                                           QUERY PLAN
---------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=5897.15..5899.49 rows=20 width=28) (actual time=4.982..6.606 rows=20 loops=1)
   Buffers: shared hit=3304
   ->  Gather Merge  (cost=5897.15..5902.05 rows=42 width=28) (actual time=4.981..6.603 rows=20 loops=1)
         Workers Planned: 2
         Workers Launched: 2
         Buffers: shared hit=3304
         ->  Sort  (cost=4897.13..4897.18 rows=21 width=28) (actual time=3.421..3.421 rows=15 loops=3)
               Sort Key: created_at DESC
               Sort Method: quicksort  Memory: 26kB
               Buffers: shared hit=3304
               Worker 0:  Sort Method: quicksort  Memory: 26kB
               Worker 1:  Sort Method: quicksort  Memory: 26kB
               ->  Parallel Seq Scan on orders  (cost=0.00..4896.67 rows=21 width=28) (actual time=0.621..3.341 rows=19 loops=3)
                     Filter: ((buyer_id = 42) AND (created_at >= (now() - '180 days'::interval)))
                     Rows Removed by Filter: 66647
                     Buffers: shared hit=3230
 Planning:
   Buffers: shared hit=97
 Planning Time: 0.383 ms
 Execution Time: 6.652 ms
(20 rows)
```

### After

```
                                                                 QUERY PLAN
--------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=0.42..82.39 rows=20 width=28) (actual time=0.025..0.102 rows=20 loops=1)
   Buffers: shared hit=26
   ->  Index Scan using orders_buyer_created_idx on orders  (cost=0.42..209.44 rows=51 width=28) (actual time=0.024..0.100 rows=20 loops=1)
         Index Cond: ((buyer_id = 42) AND (created_at >= (now() - '180 days'::interval)))
         Buffers: shared hit=26
 Planning:
   Buffers: shared hit=145
 Planning Time: 0.519 ms
 Execution Time: 0.133 ms
(9 rows)
```

**What changed.** The whole `Gather Merge → Sort → Parallel Seq Scan` stack collapsed
into a single `Index Scan`: both predicates moved from `Filter` into `Index Cond`, so the
three workers no longer read all 3230 heap pages to throw away 199 941 rows, and the
`Sort` node vanished because `created_at DESC` is the second index column — the index
already returns rows in the requested order, which lets `LIMIT 20` stop after 26 buffers
instead of 3304.

---

## q2 — admin queue of cancelled orders

`GET /admin/orders?status=cancelled&limit=50` — the refunds worklist.

```sql
SELECT id, buyer_id, total, created_at
FROM orders
WHERE status = 'cancelled'
ORDER BY created_at DESC
LIMIT 50;
```

Index: `orders_cancelled_recent_idx ON orders (created_at DESC) INCLUDE (id, buyer_id, total) WHERE status = 'cancelled'` — **partial**.

### Before

```
                                                             QUERY PLAN
-------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=5381.48..5387.31 rows=50 width=30) (actual time=5.772..7.384 rows=50 loops=1)
   Buffers: shared hit=3304
   ->  Gather Merge  (cost=5381.48..6152.70 rows=6610 width=30) (actual time=5.771..7.378 rows=50 loops=1)
         Workers Planned: 2
         Workers Launched: 2
         Buffers: shared hit=3304
         ->  Sort  (cost=4381.46..4389.72 rows=3305 width=30) (actual time=4.181..4.183 rows=41 loops=3)
               Sort Key: created_at DESC
               Sort Method: top-N heapsort  Memory: 30kB
               Buffers: shared hit=3304
               Worker 0:  Sort Method: top-N heapsort  Memory: 30kB
               Worker 1:  Sort Method: top-N heapsort  Memory: 31kB
               ->  Parallel Seq Scan on orders  (cost=0.00..4271.67 rows=3305 width=30) (actual time=0.398..3.801 rows=2688 loops=3)
                     Filter: (status = 'cancelled'::text)
                     Rows Removed by Filter: 63978
                     Buffers: shared hit=3230
 Planning:
   Buffers: shared hit=92
 Planning Time: 0.329 ms
 Execution Time: 7.432 ms
(20 rows)
```

### After

```
                                                                      QUERY PLAN
------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=0.28..2.31 rows=50 width=30) (actual time=0.018..0.025 rows=50 loops=1)
   Buffers: shared hit=3
   ->  Index Only Scan using orders_cancelled_recent_idx on orders  (cost=0.28..323.98 rows=7980 width=30) (actual time=0.017..0.020 rows=50 loops=1)
         Heap Fetches: 0
         Buffers: shared hit=3
 Planning:
   Buffers: shared hit=134
 Planning Time: 0.514 ms
 Execution Time: 0.055 ms
(9 rows)
```

**What changed.** The partial index physically contains only the ~4% of rows that are
`cancelled`, so `status = 'cancelled'` stopped being a `Filter` that discards 191 934 rows
and became the index's own definition; the `top-N heapsort` disappeared because the index
is already ordered by `created_at DESC`, and `INCLUDE (id, buyer_id, total)` carries every
selected column, which turns the node into an `Index Only Scan` with **`Heap Fetches: 0`** —
the visibility map set by `VACUUM (ANALYZE)` at the end of `seed.sql` is what keeps it at
zero, and it is why buffers fell from 3304 to 3 rather than to a few hundred.

---

## q3 — case-insensitive login lookup

`POST /auth/login` — find the account by whatever casing the user typed.

```sql
SELECT id, email, name, created_at
FROM users
WHERE lower(email) = lower('User4242@Shop.Test');
```

Index: `users_email_lower_idx ON users (lower(email))` — **expression**.

### Before

```
                                              QUERY PLAN
------------------------------------------------------------------------------------------------------
 Seq Scan on users  (cost=0.00..1218.00 rows=250 width=45) (actual time=1.007..11.526 rows=1 loops=1)
   Filter: (lower(email) = 'user4242@shop.test'::text)
   Rows Removed by Filter: 49999
   Buffers: shared hit=468
 Planning:
   Buffers: shared hit=87
 Planning Time: 0.363 ms
 Execution Time: 11.552 ms
(8 rows)
```

### After

```
                                                          QUERY PLAN
------------------------------------------------------------------------------------------------------------------------------
 Index Scan using users_email_lower_idx on users  (cost=0.41..8.43 rows=1 width=45) (actual time=0.013..0.013 rows=1 loops=1)
   Index Cond: (lower(email) = 'user4242@shop.test'::text)
   Buffers: shared hit=4
 Planning:
   Buffers: shared hit=107
 Planning Time: 0.400 ms
 Execution Time: 0.059 ms
(7 rows)
```

**What changed.** This is the classic "function in `WHERE`, index on the column" trap:
`users` already had a UNIQUE index on `email`, but the predicate is `lower(email)`, and
Postgres will not match a plain column index against a function of that column — so it
fell back to `Seq Scan`, evaluating `lower()` 50 000 times to keep one row; the expression
index stores the precomputed `lower(email)` value, so the same predicate becomes an
`Index Cond` and the scan touches 4 buffers instead of 468.

---

## Sanity check: no index added "just in case"

Three queries, three indexes. After running all three:

```sql
SELECT indexrelname, idx_scan FROM pg_stat_user_indexes WHERE idx_scan = 0;
```

```
     indexrelname              | idx_scan
-------------------------------+----------
 users_email_key               |        0
 order_items_pkey              |        0
 order_items_order_product_key |        0
```

All three optimization indexes have `idx_scan > 0`. The three that show `0` are
constraint-backing indexes Postgres creates for `UNIQUE`/`PRIMARY KEY` — they exist to
enforce correctness (no duplicate email, no duplicate product line in one order), not to
speed up a query, so a zero read count here is expected and they stay.
