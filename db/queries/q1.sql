SELECT id, status, total, created_at
FROM orders
WHERE buyer_id = 42
  AND created_at >= now() - interval '180 days'
ORDER BY created_at DESC
LIMIT 20;
