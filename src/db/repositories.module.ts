import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { OrdersRepository } from '../orders/orders.repository';
import { ProductsRepository } from '../products/products.repository';
import { UsersRepository } from '../users/users.repository';
import { PG_POOL } from './database.module';

@Module({
  providers: [
    {
      provide: UsersRepository,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => new UsersRepository(pool),
    },
    {
      provide: ProductsRepository,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => new ProductsRepository(pool),
    },
    {
      provide: OrdersRepository,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => new OrdersRepository(pool),
    },
  ],
  exports: [UsersRepository, ProductsRepository, OrdersRepository],
})
export class RepositoriesModule {}
