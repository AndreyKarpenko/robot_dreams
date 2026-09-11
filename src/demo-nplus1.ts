import type { Logger, QueryRunner } from 'typeorm';
import { In } from 'typeorm';
import AppDataSource from './data-source';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { Product } from './entities/product.entity';

class QueryCountLogger implements Logger {
  count = 0;

  logQuery(query: string, parameters?: unknown[], _queryRunner?: QueryRunner) {
    this.count += 1;
    const params = parameters?.length ? ` -- ${JSON.stringify(parameters)}` : '';
    console.log(`[query ${this.count}] ${query}${params}`);
  }

  logQueryError() {}
  logQuerySlow() {}
  logSchemaBuild() {}
  logMigration() {}
  log() {}
}

async function naiveLoad(orderIds: string[]): Promise<number> {
  const orderRepo = AppDataSource.getRepository(Order);
  const itemRepo = AppDataSource.getRepository(OrderItem);
  const productRepo = AppDataSource.getRepository(Product);

  const orders = await orderRepo.find({
    where: { id: In(orderIds) },
  });
  for (const order of orders) {
    const items = await itemRepo.find({ where: { orderId: order.id } });
    for (const item of items) {
      await productRepo.findOneByOrFail({ id: item.productId });
    }
  }
  return orders.length;
}

async function fixedLoad(orderIds: string[]): Promise<number> {
  const orders = await AppDataSource.getRepository(Order)
    .createQueryBuilder('ord')
    .leftJoinAndSelect('ord.items', 'item')
    .leftJoinAndSelect('item.product', 'product')
    .where('ord.id IN (:...ids)', { ids: orderIds })
    .getMany();
  return orders.length;
}

async function queryStrategyLoad(orderIds: string[]): Promise<number> {
  const orders = await AppDataSource.getRepository(Order).find({
    where: { id: In(orderIds) },
    relations: { items: { product: true } },
    relationLoadStrategy: 'query',
  });
  return orders.length;
}

async function main(): Promise<void> {
  const logger = new QueryCountLogger();
  AppDataSource.setOptions({ logging: ['query'], logger });
  await AppDataSource.initialize();
  try {
    const orders = await AppDataSource.getRepository(Order).find({
      order: { id: 'ASC' },
    });
    if (orders.length === 0) {
      throw new Error('No orders in the database. Run npm run seed first.');
    }
    const orderIds = orders.map((order) => order.id);
    const n = orderIds.length;

    logger.count = 0;
    console.log('\n=== naive (query per relation in a loop), graph order → items → product ===');
    await naiveLoad(orderIds);
    const naiveCount = logger.count;

    logger.count = 0;
    console.log('\n=== fixed (leftJoinAndSelect), N orders ===');
    await fixedLoad(orderIds);
    const fixedCount = logger.count;

    logger.count = 0;
    console.log('\n=== fixed (leftJoinAndSelect), 3 orders (N independence) ===');
    await fixedLoad(orderIds.slice(0, 3));
    const fixedSmallCount = logger.count;

    logger.count = 0;
    console.log('\n=== relationLoadStrategy: query (order → items → product) ===');
    await queryStrategyLoad(orderIds);
    const queryStrategyCount = logger.count;

    console.log('\n=== N+1 query counts ===');
    console.log(`N (orders): ${n}`);
    console.log(`naive (query in a loop): ${naiveCount}`);
    console.log(`relations / leftJoinAndSelect (N=${n}): ${fixedCount}`);
    console.log(`relations / leftJoinAndSelect (N=3): ${fixedSmallCount}`);
    console.log(`relationLoadStrategy: 'query': ${queryStrategyCount}`);
  } finally {
    await AppDataSource.destroy();
  }
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
