import AppDataSource from './data-source';
import { OrderItem } from './entities/order-item.entity';
import { Order } from './entities/order.entity';
import { Product } from './entities/product.entity';
import { User } from './entities/user.entity';

const SEED_USERS: Array<{ email: string; name: string }> = [
  { email: 'seller.anna@shop.test', name: 'Anna Seller' },
  { email: 'seller.bohdan@shop.test', name: 'Bohdan Seller' },
  { email: 'seller.cyril@shop.test', name: 'Cyril Seller' },
  { email: 'buyer.daria@shop.test', name: 'Daria Buyer' },
  { email: 'buyer.ehor@shop.test', name: 'Ehor Buyer' },
  { email: 'buyer.fedir@shop.test', name: 'Fedir Buyer' },
  { email: 'buyer.galyna@shop.test', name: 'Galyna Buyer' },
  { email: 'buyer.hanna@shop.test', name: 'Hanna Buyer' },
];

const PRODUCT_SPECS: Array<{ sellerEmail: string; name: string; price: number }> =
  [
    { sellerEmail: 'seller.anna@shop.test', name: 'Ceramic mug', price: 1299 },
    { sellerEmail: 'seller.anna@shop.test', name: 'Linen tote', price: 2499 },
    { sellerEmail: 'seller.anna@shop.test', name: 'Soy candle', price: 899 },
    { sellerEmail: 'seller.bohdan@shop.test', name: 'Oak cutting board', price: 4599 },
    { sellerEmail: 'seller.bohdan@shop.test', name: 'Cast-iron pan', price: 7999 },
    { sellerEmail: 'seller.bohdan@shop.test', name: 'Herb mill', price: 1599 },
    { sellerEmail: 'seller.cyril@shop.test', name: 'Wool scarf', price: 3299 },
    { sellerEmail: 'seller.cyril@shop.test', name: 'Leather notebook', price: 2199 },
    { sellerEmail: 'seller.cyril@shop.test', name: 'Fountain pen', price: 5499 },
    { sellerEmail: 'seller.cyril@shop.test', name: 'Desk lamp', price: 6799 },
  ];

const ORDER_SPECS: Array<{
  buyerEmail: string;
  status: Order['status'];
  lines: Array<{ productName: string; quantity: number }>;
}> = [
  {
    buyerEmail: 'buyer.daria@shop.test',
    status: 'paid',
    lines: [
      { productName: 'Ceramic mug', quantity: 2 },
      { productName: 'Soy candle', quantity: 1 },
    ],
  },
  {
    buyerEmail: 'buyer.daria@shop.test',
    status: 'shipped',
    lines: [
      { productName: 'Wool scarf', quantity: 1 },
      { productName: 'Leather notebook', quantity: 1 },
    ],
  },
  {
    buyerEmail: 'buyer.ehor@shop.test',
    status: 'paid',
    lines: [
      { productName: 'Oak cutting board', quantity: 1 },
      { productName: 'Herb mill', quantity: 2 },
    ],
  },
  {
    buyerEmail: 'buyer.ehor@shop.test',
    status: 'created',
    lines: [
      { productName: 'Cast-iron pan', quantity: 1 },
      { productName: 'Desk lamp', quantity: 1 },
    ],
  },
  {
    buyerEmail: 'buyer.fedir@shop.test',
    status: 'shipped',
    lines: [
      { productName: 'Linen tote', quantity: 3 },
      { productName: 'Fountain pen', quantity: 1 },
    ],
  },
  {
    buyerEmail: 'buyer.fedir@shop.test',
    status: 'cancelled',
    lines: [
      { productName: 'Soy candle', quantity: 4 },
      { productName: 'Ceramic mug', quantity: 1 },
    ],
  },
  {
    buyerEmail: 'buyer.galyna@shop.test',
    status: 'paid',
    lines: [
      { productName: 'Desk lamp', quantity: 1 },
      { productName: 'Leather notebook', quantity: 2 },
    ],
  },
  {
    buyerEmail: 'buyer.hanna@shop.test',
    status: 'paid',
    lines: [
      { productName: 'Wool scarf', quantity: 2 },
      { productName: 'Herb mill', quantity: 1 },
    ],
  },
];

async function upsertUser(email: string, name: string): Promise<User> {
  const repo = AppDataSource.getRepository(User);
  let user = await repo.findOne({ where: { email } });
  if (!user) {
    user = repo.create({ email, name });
  } else {
    user.name = name;
  }
  return repo.save(user);
}

async function upsertProduct(
  seller: User,
  name: string,
  price: number,
): Promise<Product> {
  const repo = AppDataSource.getRepository(Product);
  let product = await repo.findOne({
    where: { name, seller: { id: seller.id } },
  });
  if (!product) {
    product = repo.create({ name, price, seller });
  } else {
    product.price = price;
    product.seller = seller;
  }
  return repo.save(product);
}

function productNamesKey(names: string[]): string {
  return [...names].sort().join('\0');
}

async function findSeedOrder(
  buyer: User,
  spec: (typeof ORDER_SPECS)[number],
): Promise<Order | null> {
  const orderRepo = AppDataSource.getRepository(Order);
  const wanted = productNamesKey(spec.lines.map((line) => line.productName));
  const candidates = await orderRepo.find({
    where: { buyer: { id: buyer.id }, status: spec.status },
    relations: { items: { product: true } },
  });

  const complete = candidates.find(
    (order) =>
      productNamesKey(order.items.map((item) => item.product.name)) === wanted,
  );
  if (complete) {
    return complete;
  }

  // Interrupted insert: header exists, lines were not written yet.
  return (
    candidates.find((order) => order.items.length === 0) ?? null
  );
}

async function upsertOrder(
  spec: (typeof ORDER_SPECS)[number],
  users: Map<string, User>,
  productsByName: Map<string, Product>,
): Promise<void> {
  const orderRepo = AppDataSource.getRepository(Order);
  const itemRepo = AppDataSource.getRepository(OrderItem);
  const buyer = users.get(spec.buyerEmail);
  if (!buyer) {
    throw new Error(`Unknown seed buyer ${spec.buyerEmail}`);
  }

  const lines = spec.lines.map((line) => {
    const product = productsByName.get(line.productName);
    if (!product) {
      throw new Error(`Unknown seed product ${line.productName}`);
    }
    return {
      product,
      quantity: line.quantity,
      unitPrice: product.price,
    };
  });
  const total = lines.reduce(
    (sum, line) => sum + line.unitPrice * line.quantity,
    0,
  );

  let order = await findSeedOrder(buyer, spec);
  if (!order) {
    order = await orderRepo.save(
      orderRepo.create({ buyer, status: spec.status, total }),
    );
  } else if (order.total !== total) {
    order.total = total;
    await orderRepo.save(order);
  }

  for (const line of lines) {
    const existingItem = await itemRepo.findOne({
      where: { orderId: order.id, productId: line.product.id },
    });
    if (!existingItem) {
      await itemRepo.save(
        itemRepo.create({
          order,
          product: line.product,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        }),
      );
    }
  }
}

async function seedOrders(
  users: Map<string, User>,
  productsByName: Map<string, Product>,
): Promise<void> {
  for (const spec of ORDER_SPECS) {
    await upsertOrder(spec, users, productsByName);
  }
}

async function seed(): Promise<void> {
  await AppDataSource.initialize();
  try {
    const users = new Map<string, User>();
    for (const row of SEED_USERS) {
      users.set(row.email, await upsertUser(row.email, row.name));
    }

    const productsByName = new Map<string, Product>();
    for (const spec of PRODUCT_SPECS) {
      const seller = users.get(spec.sellerEmail);
      if (!seller) {
        throw new Error(`Unknown seed seller ${spec.sellerEmail}`);
      }
      productsByName.set(
        spec.name,
        await upsertProduct(seller, spec.name, spec.price),
      );
    }

    await seedOrders(users, productsByName);

    const counts = {
      users: await AppDataSource.getRepository(User).count(),
      products: await AppDataSource.getRepository(Product).count(),
      orders: await AppDataSource.getRepository(Order).count(),
      order_items: await AppDataSource.getRepository(OrderItem).count(),
    };
    console.log('seed complete', counts);
  } finally {
    await AppDataSource.destroy();
  }
}

void seed().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
