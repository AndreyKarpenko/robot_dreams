import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Order } from './order.entity';
import { Product } from './product.entity';

@Entity({ name: 'order_items' })
@Unique('order_items_order_product_key', ['order', 'product'])
@Check('CHK_order_items_qty_positive', `"quantity" >= 1`)
@Check('CHK_order_items_price_nonneg', `"unit_price" >= 0`)
export class OrderItem {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'int' })
  quantity: number;

  /** Snapshot of product price in minor units at checkout. Integer, never float. */
  @Column({ type: 'int', name: 'unit_price' })
  unitPrice: number;

  @Column({ type: 'bigint', name: 'order_id' })
  orderId: string;

  @Column({ type: 'bigint', name: 'product_id' })
  productId: string;

  @ManyToOne(() => Order, (order) => order.items, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({
    name: 'order_id',
    foreignKeyConstraintName: 'order_items_order_fk',
  })
  order: Order;

  @ManyToOne(() => Product, (product) => product.orderItems, {
    onDelete: 'RESTRICT',
    nullable: false,
  })
  @JoinColumn({
    name: 'product_id',
    foreignKeyConstraintName: 'order_items_product_fk',
  })
  product: Product;
}
