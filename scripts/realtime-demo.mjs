import { io } from 'socket.io-client';

const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const sameRoom = process.argv.includes('--same-room');

const socketARef = { current: undefined };
const socketBRef = { current: undefined };

try {
  const productId = await firstProductId();
  const orderA = await createOrder(productId);
  const orderB = await createOrder(productId);
  if (orderA.buyer_id == null || orderB.buyer_id == null) {
    throw new Error('order response has no buyer_id');
  }

  const roomB = sameRoom ? orderA.id : orderB.id;
  const expectedB = sameRoom ? 1 : 0;

  const socketA = await connect(orderA.buyer_id);
  const socketB = await connect(orderB.buyer_id);
  socketARef.current = socketA;
  socketBRef.current = socketB;

  let aCount = 0;
  let bCount = 0;
  socketA.on('order.status', () => {
    aCount += 1;
  });
  socketB.on('order.status', () => {
    bCount += 1;
  });

  await join(socketA, orderA.id);
  await join(socketB, roomB);
  await setStatus(orderA.id, 'paid');

  await waitFor(() => aCount > 0 && (expectedB === 0 || bCount > 0), 3000);
  if (expectedB === 0) {
    await sleep(400);
  }

  const aReceived = aCount > 0 ? 1 : 0;
  const bReceived = bCount > 0 ? 1 : 0;
  console.log(`A_RECEIVED=${aReceived}`);
  console.log(`B_RECEIVED=${bReceived}`);
  shutdown(aReceived === 1 && bReceived === expectedB ? 0 : 1);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  shutdown(1);
}

function shutdown(code) {
  socketARef.current?.disconnect();
  socketBRef.current?.disconnect();
  process.exit(code);
}

async function firstProductId() {
  const res = await fetch(`${baseUrl}/products`);
  if (!res.ok) {
    throw new Error(`GET /products failed: ${res.status}`);
  }
  const body = await res.json();
  const id = body.items?.[0]?.id;
  if (!id) {
    throw new Error('no products; seed the database before the demo');
  }
  return id;
}

async function createOrder(productId) {
  const res = await fetch(`${baseUrl}/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items: [{ product_id: productId, quantity: 1 }] }),
  });
  if (!res.ok) {
    throw new Error(
      `POST /orders failed: ${res.status} ${await res.text()}. Set DEFAULT_BUYER_ID to a seeded buyer before starting the API.`,
    );
  }
  return res.json();
}

function connect(buyerId) {
  const socket = io(baseUrl, {
    forceNew: true,
    reconnection: false,
    timeout: 5000,
    auth: { userId: String(buyerId) },
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('connect timeout')), 5000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function join(socket, orderId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`join timeout for order ${orderId}`)),
      5000,
    );
    socket.emit('join', { orderId }, (ack) => {
      clearTimeout(timer);
      if (ack && ack.ok === true) {
        resolve(ack);
      } else {
        reject(new Error(`join refused: ${JSON.stringify(ack)}`));
      }
    });
  });
}

async function setStatus(orderId, status) {
  const res = await fetch(`${baseUrl}/orders/${orderId}/status`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    throw new Error(`PATCH status failed: ${res.status} ${await res.text()}`);
  }
}

function waitFor(predicate, ms) {
  const started = Date.now();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (predicate() || Date.now() - started >= ms) {
        clearInterval(timer);
        resolve();
      }
    }, 50);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
