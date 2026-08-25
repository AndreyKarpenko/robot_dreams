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

app.get('/products', (req, res) => {
  const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
  const all = [...products.values()];
  let start = 0;
  if (req.query.cursor) {
    start = Number(Buffer.from(String(req.query.cursor), 'base64').toString('utf8'));
    if (Number.isNaN(start) || start < 0) {
      start = 0;
    }
  }
  const page = all.slice(start, start + limit);
  const nextIndex = start + page.length;
  res.status(200).json({
    items: page,
    next_cursor:
      nextIndex < all.length
        ? Buffer.from(String(nextIndex), 'utf8').toString('base64')
        : null,
  });
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
  res.status(201).json(order);
});

app.use((err, req, res, _next) => {
  const status = err.status || 500;
  const titles = {
    400: 'Bad Request',
    404: 'Not Found',
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
