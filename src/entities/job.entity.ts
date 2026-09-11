import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'jobs' })
@Index('jobs_pending_idx', { synchronize: false })
@Check(`"kind" <> ''`)
@Check(`"status" IN ('pending', 'done')`)
@Check(`"processed" >= 0`)
export class Job {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'text' })
  kind: string;

  @Column({ type: 'jsonb', default: {} })
  payload: Record<string, unknown>;

  @Column({ type: 'text', default: 'pending' })
  status: 'pending' | 'done';

  /** How many times this row was processed. Exactly-once ⇒ 1. */
  @Column({ type: 'int', default: 0 })
  processed: number;

  @Column({ type: 'text', name: 'worker_id', nullable: true })
  workerId: string | null;

  @Column({ type: 'text', nullable: true })
  result: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
