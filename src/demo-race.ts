import AppDataSource from './data-source';
import { checkout } from './checkout';
import {
  InsufficientBalanceError,
  InsufficientStockError,
} from './checkout-errors';
import { Product } from './entities/product.entity';
import { User } from './entities/user.entity';

const ATTEMPTS = 50;
const STOCK = 10;
const QTY = 1;
const BUYER_BALANCE = 10_000_000;

function isExpectedCheckoutFailure(err: unknown): boolean {
  return (
    err instanceof InsufficientStockError ||
    err instanceof InsufficientBalanceError
  );
}

async function main(): Promise<void> {
  AppDataSource.setOptions({
    poolSize: ATTEMPTS,
    extra: { max: ATTEMPTS },
  });
  await AppDataSource.initialize();
  try {
    const buyers = await AppDataSource.getRepository(User)
      .createQueryBuilder('u')
      .where("u.email LIKE 'buyer.%'")
      .orderBy('u.id', 'ASC')
      .getMany();
    if (buyers.length === 0) {
      throw new Error('No seed buyers. Run npm run seed first.');
    }

    const product = await AppDataSource.getRepository(Product).findOne({
      where: { name: 'Ceramic mug' },
    });
    if (!product) {
      throw new Error('Seed product "Ceramic mug" is missing. Run npm run seed.');
    }

    await AppDataSource.query(
      `UPDATE products SET stock = $1 WHERE id = $2`,
      [STOCK, product.id],
    );
    await AppDataSource.query(
      `UPDATE users SET balance = $1 WHERE email LIKE 'buyer.%'`,
      [BUYER_BALANCE],
    );

    const results = await Promise.all(
      Array.from({ length: ATTEMPTS }, (_, i) => {
        const buyer = buyers[i % buyers.length];
        return checkout(AppDataSource, {
          buyerId: buyer.id,
          productId: product.id,
          quantity: QTY,
        })
          .then(() => 'ok' as const)
          .catch((err: unknown) => {
            if (isExpectedCheckoutFailure(err)) {
              return 'fail' as const;
            }
            throw err;
          });
      }),
    );

    const successful = results.filter((row) => row === 'ok').length;
    const [{ stock: finalStock }] = (await AppDataSource.query(
      `SELECT stock FROM products WHERE id = $1`,
      [product.id],
    )) as Array<{ stock: number }>;
    const [{ negatives }] = (await AppDataSource.query(
      `SELECT count(*)::int AS negatives FROM products WHERE stock < 0`,
    )) as Array<{ negatives: number }>;

    console.log(`спроб: ${ATTEMPTS}`);
    console.log(`успішних: ${successful}`);
    console.log(`фінальний stock: ${Number(finalStock)}`);
    console.log(`рядків із відʼємним stock: ${Number(negatives)}`);

    const ok =
      ATTEMPTS >= 50 &&
      successful === STOCK &&
      Number(finalStock) === 0 &&
      Number(negatives) === 0;
    if (!ok) {
      console.error('invariant failed: oversell or unexpected counts');
      process.exit(1);
    }
  } finally {
    await AppDataSource.destroy();
  }
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
