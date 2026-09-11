import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OrderItem } from './order-item.entity';
import { User } from './user.entity';

@Entity({ name: 'products' })
@Check(`"name" <> ''`)
@Check(`"price" >= 0`)
@Check(`"stock" >= 0`)
export class Product {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'text' })
  name: string;

  /** Price in minor units (cents). Integer, never float. */
  @Column({ type: 'int' })
  price: number;

  /** Units available for sale. Decremented atomically at checkout. */
  @Column({ type: 'int', default: 0 })
  stock: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => User, (user) => user.products, {
    onDelete: 'RESTRICT',
    nullable: false,
  })
  @JoinColumn({
    name: 'seller_id',
    foreignKeyConstraintName: 'products_seller_fk',
  })
  seller: User;

  @OneToMany(() => OrderItem, (item) => item.product)
  orderItems: OrderItem[];
}
