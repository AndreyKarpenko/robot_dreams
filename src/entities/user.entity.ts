import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Order } from './order.entity';
import { Product } from './product.entity';

@Entity({ name: 'users' })
@Index('users_email_lower_idx', { synchronize: false })
@Check(`"email" <> ''`)
@Check(`"email" LIKE '%@%'`)
@Check(`"name" <> ''`)
@Check(`"balance" >= 0`)
export class User {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'text' })
  email: string;

  @Column({ type: 'text' })
  name: string;

  /** Wallet balance in minor units (cents). Integer, never float. */
  @Column({ type: 'int', default: 0 })
  balance: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @OneToMany(() => Product, (product) => product.seller)
  products: Product[];

  @OneToMany(() => Order, (order) => order.buyer)
  orders: Order[];
}
