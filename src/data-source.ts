import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { OrderItem } from './entities/order-item.entity';
import { Order } from './entities/order.entity';
import { Product } from './entities/product.entity';
import { User } from './entities/user.entity';
import { InitialSchema1757520000000 } from './migrations/1757520000000-InitialSchema';

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

const AppDataSource = new DataSource({
  type: 'postgres',
  host: env('DB_HOST'),
  port: Number(env('DB_PORT')),
  username: env('DB_USER'),
  password: process.env.DB_PASSWORD,
  database: env('DB_NAME'),
  synchronize: false,
  logging: false,
  entities: [User, Product, Order, OrderItem],
  migrations: [InitialSchema1757520000000],
});

export default AppDataSource;
