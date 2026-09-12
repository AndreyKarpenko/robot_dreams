import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OrderItem } from './order-item.entity';
import { User } from './user.entity';

@Entity({ name: 'orders' })
@Index('orders_buyer_created_idx', ['buyer', 'createdAt'])
@Index('orders_queue_recent_idx', { synchronize: false })
@Check(
  'CHK_orders_status_allowed',
  `"status" IN ('created', 'paid', 'shipped', 'cancelled')`,
)
@Check('CHK_orders_total_nonneg', `"total" >= 0`)
export class Order {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'text' })
  status: 'created' | 'paid' | 'shipped' | 'cancelled';

  /** Order total in minor units (cents). Integer, never float. */
  @Column({ type: 'int', default: 0 })
  total: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => User, (user) => user.orders, {
    onDelete: 'RESTRICT',
    nullable: false,
  })
  @JoinColumn({
    name: 'buyer_id',
    foreignKeyConstraintName: 'orders_buyer_fk',
  })
  buyer: User;

  @OneToMany(() => OrderItem, (item) => item.order)
  items: OrderItem[];
}
