const path = require('path');
const express = require('express');
const OpenApiValidator = require('express-openapi-validator');

const app = express();
const port = process.env.PORT ?? 3000;

const products = new Map([
  [1, { id: 1, name: 'Notebook', price_cents: 1299 }],
  [2, { id: 2, name: 'Pen', price_cents: 199 }],
]);
const orders = new Map();
const idempotencyStore = new Map();
let nextOrderId = 1;

app.use(express.json());

app.use(
  OpenApiValidator.middleware({
    apiSpec: path.join(__dirname, 'openapi/openapi.yaml'),
    validateRequests: true,
    validateResponses: true,
  }),
);

function sendProblem(res, req, status, title, detail) {
  res.status(status).type('application/problem+json').json({
    type: `https://example.com/problems/${status}`,
    title,
    status,
    detail,
    instance: req.originalUrl,
  });
}

function paginate(list, cursor, limit) {
  const size = limit === undefined ? 20 : Number(limit);
  let start = 0;
  if (cursor) {
    start = Number(Buffer.from(String(cursor), 'base64').toString('utf8'));
    if (Number.isNaN(start) || start < 0) {
      start = 0;
    }
  }
  const page = list.slice(start, start + size);
  const nextIndex = start + page.length;
  return {
    items: page,
    next_cursor:
      nextIndex < list.length
        ? Buffer.from(String(nextIndex), 'utf8').toString('base64')
        : null,
  };
}

app.get('/products', (req, res) => {
  res.status(200).json(
    paginate([...products.values()], req.query.cursor, req.query.limit),
  );
});

app.get('/products/:id', (req, res) => {
  const product = products.get(Number(req.params.id));
  if (!product) {
    sendProblem(res, req, 404, 'Not Found', `Product ${req.params.id} not found`);
    return;
  }
  res.status(200).json(product);
});

app.get('/orders', (req, res) => {
  res.status(200).json(
    paginate([...orders.values()], req.query.cursor, req.query.limit),
  );
});

app.get('/orders/:id', (req, res) => {
  const order = orders.get(Number(req.params.id));
  if (!order) {
    sendProblem(res, req, 404, 'Not Found', `Order ${req.params.id} not found`);
    return;
  }
  res.status(200).json(order);
});

app.post('/orders', (req, res) => {
  const key = req.headers['idempotency-key'];
  const fingerprint = JSON.stringify(req.body);
  const prior = idempotencyStore.get(key);

  if (prior) {
    if (prior.fingerprint !== fingerprint) {
      sendProblem(
        res,
        req,
        422,
        'Unprocessable Entity',
        'Idempotency-Key was reused with a different request body',
      );
      return;
    }
    res.set('Idempotency-Replay', 'true');
    res.status(201).json(prior.order);
    return;
  }

  const items = [];
  let total_cents = 0;

  for (const line of req.body.items) {
    const product = products.get(line.product_id);
    if (!product) {
      sendProblem(
        res,
        req,
        400,
        'Bad Request',
        `Unknown product_id: ${line.product_id}`,
      );
      return;
    }
    items.push({
      product_id: line.product_id,
      quantity: line.quantity,
      price_cents: product.price_cents,
    });
    total_cents += product.price_cents * line.quantity;
  }

  const order = {
    id: nextOrderId,
    status: 'created',
    items,
    total_cents,
  };
  orders.set(nextOrderId, order);
  nextOrderId += 1;
  idempotencyStore.set(key, { fingerprint, order });
  res.status(201).json(order);
});

app.use((req, res) => {
  sendProblem(
    res,
    req,
    404,
    'Not Found',
    `No route for ${req.method} ${req.originalUrl}`,
  );
});

app.use((err, req, res, _next) => {
  const status = err.status || 500;
  const titles = {
    400: 'Bad Request',
    404: 'Not Found',
    422: 'Unprocessable Entity',
    500: 'Internal Server Error',
  };
  sendProblem(
    res,
    req,
    status,
    titles[status] || 'Error',
    err.message || 'Unexpected error',
  );
});

app.listen(port, () => {
  console.log(`Marketplace API listening on http://localhost:${port}`);
});
