SELECT id, email, name, created_at
FROM users
WHERE lower(email) = lower('User4242@Shop.Test');
