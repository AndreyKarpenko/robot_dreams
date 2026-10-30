import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity({ name: 'files' })
@Index('files_owner_idempotency_idx', { synchronize: false })
@Index('files_pending_created_idx', { synchronize: false })
@Check('CHK_files_key_nonempty', `"key" <> ''`)
@Check('CHK_files_status_allowed', `"status" IN ('PENDING', 'COMPLETED')`)
@Check('CHK_files_size_positive', `"size" > 0`)
@Check('CHK_files_content_type_nonempty', `"content_type" <> ''`)
export class StoredFile {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'text', unique: true })
  key: string;

  @Column({ type: 'bigint', name: 'owner_id' })
  ownerId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @Column({ type: 'text', default: 'PENDING' })
  status: 'PENDING' | 'COMPLETED';

  @Column({ type: 'bigint' })
  size: string;

  @Column({ type: 'text', name: 'upload_id', nullable: true })
  uploadId: string | null;

  @Column({ type: 'text', name: 'content_type' })
  contentType: string;

  @Column({ type: 'text', name: 'idempotency_key', nullable: true })
  idempotencyKey: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
