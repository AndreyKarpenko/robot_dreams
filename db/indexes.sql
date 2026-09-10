-- Minimal index set that fixes all three queries in db/queries/.
-- Three queries, three indexes, nothing "just in case": every extra index costs
-- disk and slows down INSERT. Verify afterwards with
--   SELECT indexrelname, idx_scan FROM pg_stat_user_indexes WHERE idx_scan = 0;

DROP INDEX IF EXISTS orders_buyer_created_idx;
DROP INDEX IF EXISTS orders_cancelled_recent_idx;
DROP INDEX IF EXISTS orders_queue_recent_idx;
DROP INDEX IF EXISTS users_email_lower_idx;

-- q1 — "orders of one buyer for the last 180 days, newest first" (q1.sql).
-- Composite: buyer_id gives the equality prefix, created_at DESC makes the
-- ORDER BY free, so the Sort node disappears together with the Seq Scan.
CREATE INDEX orders_buyer_created_idx
  ON orders (buyer_id, created_at DESC);

-- q2 — admin work queues (`created` ~9%, `cancelled` ~4%). PARTIAL: paid and
-- shipped are ~87% of the table and are not a queue, so indexing them would be
-- dead weight. Leading `status` keeps each queue ordered by created_at DESC on
-- its own; INCLUDE carries the payload, which turns the plan into an Index Only
-- Scan. The visibility map set by VACUUM in seed.sql keeps Heap Fetches at 0.
CREATE INDEX orders_queue_recent_idx
  ON orders (status, created_at DESC)
  INCLUDE (id, buyer_id, total)
  WHERE status IN ('created', 'cancelled');

-- q3 — case-insensitive login lookup. UNIQUE EXPRESSION index: UNIQUE (email)
-- would still allow USER4242@shop.test next to user4242@shop.test, and the
-- planner will not use a plain column index for lower(email). One index both
-- enforces the real uniqueness and matches the query predicate.
CREATE UNIQUE INDEX users_email_lower_idx
  ON users (lower(email));
