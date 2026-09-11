import AppDataSource from './data-source';
import { OrderItem } from './entities/order-item.entity';

async function report(): Promise<void> {
  await AppDataSource.initialize();
  try {
    const rows = await AppDataSource.getRepository(OrderItem)
      .createQueryBuilder('item')
      .innerJoin('item.order', 'ord')
      .innerJoin('item.product', 'product')
      .innerJoin('product.seller', 'seller')
      .select('seller.id', 'seller_id')
      .addSelect('seller.name', 'seller_name')
      .addSelect('SUM(item.quantity * item.unitPrice)', 'revenue_cents')
      .addSelect('COUNT(DISTINCT ord.id)', 'paid_order_count')
      .where('ord.status IN (:...statuses)', {
        statuses: ['paid', 'shipped'],
      })
      .groupBy('seller.id')
      .addGroupBy('seller.name')
      .orderBy('revenue_cents', 'DESC')
      .getRawMany();

    console.log('Revenue by seller (paid + shipped), minor units:');
    console.table(rows);
  } finally {
    await AppDataSource.destroy();
  }
}

void report().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
