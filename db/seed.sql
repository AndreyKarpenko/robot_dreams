-- Realistic volume for the Marketplace API.
-- Main table is `orders`: 200 000 rows. Distributions are deliberately skewed,
-- because a uniform 33/33/33 dataset makes the planner's choices meaningless.
--
--   users        50 000
--   products     50 000  (seller activity follows a power curve)
--   orders      200 000  (buyer activity follows a power curve, 18 months of history)
--   order_items ~400 000 (1-3 lines per order)
--
-- Idempotent: TRUNCATE first, so re-running never doubles the data.
-- Ends with VACUUM (ANALYZE), not plain ANALYZE: ANALYZE only refreshes planner
-- statistics, while the visibility map that makes Index Only Scan skip the heap
-- is set by VACUUM. Without it every "after" plan would still report Heap Fetches.

TRUNCATE TABLE order_items, orders, products, users RESTART IDENTITY CASCADE;

INSERT INTO users (email, name, created_at)
SELECT
  'user' || i || '@shop.test',
  'User ' || i,
  now() - (random() * interval '720 days')
FROM generate_series(1, 50000) AS i;

-- Sellers are skewed: a few power sellers hold most of the catalogue.
INSERT INTO products (seller_id, name, price, created_at)
SELECT
  1 + floor(power(random(), 3) * 50000)::bigint,
  (ARRAY['Wireless', 'Ergonomic', 'Refurbished', 'Compact', 'Premium', 'Vintage'])[1 + (i % 6)]
    || ' '
    || (ARRAY['Keyboard', 'Mouse', 'Monitor', 'Headset', 'Webcam', 'Dock', 'Lamp'])[1 + (i % 7)]
    || ' #' || i,
  round((random() * 490 + 9.99)::numeric, 2),
  now() - (random() * interval '600 days')
FROM generate_series(1, 50000) AS i;

-- Buyers are skewed the same way; statuses are lifelike, not uniform:
-- paid 62%, shipped 25%, created 9%, cancelled 4%.
-- The three rolls come from a sub-SELECT so that random() is evaluated once per
-- row: reusing one roll in several CASE branches would re-roll it each time.
INSERT INTO orders (buyer_id, status, created_at)
SELECT
  1 + floor(power(g.buyer_roll, 3) * 50000)::bigint,
  CASE
    WHEN g.status_roll < 0.62 THEN 'paid'
    WHEN g.status_roll < 0.87 THEN 'shipped'
    WHEN g.status_roll < 0.96 THEN 'created'
    ELSE 'cancelled'
  END,
  now() - (g.age_roll * interval '540 days')
FROM (
  SELECT
    random() AS buyer_roll,
    random() AS status_roll,
    random() AS age_roll
  FROM generate_series(1, 200000)
) AS g;

-- 1-3 distinct lines per order. The product picker is deterministic modular
-- arithmetic so that (order_id, product_id) never collides with itself.
INSERT INTO order_items (order_id, product_id, quantity, unit_price)
SELECT
  o.id,
  p.id,
  1 + (g % 3),
  p.price
FROM orders AS o
CROSS JOIN LATERAL generate_series(1, 1 + (o.id % 3)) AS g
JOIN products AS p ON p.id = 1 + ((o.id * 7 + g * 20011) % 50000);

UPDATE orders AS o
SET total = s.line_total
FROM (
  SELECT order_id, sum(quantity * unit_price) AS line_total
  FROM order_items
  GROUP BY order_id
) AS s
WHERE o.id = s.order_id;

VACUUM (ANALYZE);
