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
@Check('CHK_users_email_nonempty', `"email" <> ''`)
@Check('CHK_users_email_shaped', `"email" LIKE '%@%'`)
@Check('CHK_users_name_nonempty', `"name" <> ''`)
@Check('CHK_users_balance_nonneg', `"balance" >= 0`)
@Check(
  'CHK_users_role_allowed',
  `"role" IN ('buyer', 'seller', 'admin')`,
)
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

  @Column({ type: 'text', default: 'buyer' })
  role: 'buyer' | 'seller' | 'admin';

  @Column({ type: 'text', name: 'password_hash', nullable: true })
  passwordHash: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @OneToMany(() => Product, (product) => product.seller)
  products: Product[];

  @OneToMany(() => Order, (order) => order.buyer)
  orders: Order[];
}
