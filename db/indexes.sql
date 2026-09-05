-- Minimal index set that fixes all three queries in db/queries/.
-- Three queries, three indexes, nothing "just in case": every extra index costs
-- disk and slows down INSERT. Verify afterwards with
--   SELECT indexrelname, idx_scan FROM pg_stat_user_indexes WHERE idx_scan = 0;

DROP INDEX IF EXISTS orders_buyer_created_idx;
DROP INDEX IF EXISTS orders_cancelled_recent_idx;
DROP INDEX IF EXISTS users_email_lower_idx;

-- q1 — "orders of one buyer for the last 30 days, newest first".
-- Composite: buyer_id gives the equality prefix, created_at DESC makes the
-- ORDER BY free, so the Sort node disappears together with the Seq Scan.
CREATE INDEX orders_buyer_created_idx
  ON orders (buyer_id, created_at DESC);

-- q2 — admin queue of cancelled orders. PARTIAL: 'cancelled' is ~4% of the
-- table, so indexing the other 96% would be dead weight. INCLUDE carries the
-- payload columns, which turns the plan into an Index Only Scan; the visibility
-- map set by VACUUM in seed.sql keeps Heap Fetches at 0.
CREATE INDEX orders_cancelled_recent_idx
  ON orders (created_at DESC)
  INCLUDE (id, buyer_id, total)
  WHERE status = 'cancelled';

-- q3 — case-insensitive login lookup. EXPRESSION index: the existing
-- users_email_key UNIQUE index is on `email`, but the query filters on
-- `lower(email)`, and the planner will not use a plain column index for a
-- function of that column. The index has to be built on the same expression.
CREATE INDEX users_email_lower_idx
  ON users (lower(email));
