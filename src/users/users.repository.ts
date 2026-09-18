import type { Queryable } from '../db/queryable';

export type UserRow = {
  id: string;
  email: string;
  name: string;
  balance: number;
  created_at: Date;
};

export class UsersRepository {
  constructor(private readonly db: Queryable) {}

  async insert(input: {
    email: string;
    name: string;
    balance?: number;
  }): Promise<UserRow> {
    const result = await this.db.query<UserRow>(
      `INSERT INTO users (email, name, balance)
       VALUES ($1, $2, $3)
       RETURNING id, email, name, balance, created_at`,
      [input.email, input.name, input.balance ?? 0],
    );
    return result.rows[0];
  }

  async findById(id: string | number): Promise<UserRow | null> {
    const result = await this.db.query<UserRow>(
      `SELECT id, email, name, balance, created_at
         FROM users
        WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const result = await this.db.query<UserRow>(
      `SELECT id, email, name, balance, created_at
         FROM users
        WHERE lower(email) = lower($1)`,
      [email],
    );
    return result.rows[0] ?? null;
  }

  async upsertByEmail(input: {
    email: string;
    name: string;
    balance?: number;
  }): Promise<UserRow> {
    const result = await this.db.query<UserRow>(
      `INSERT INTO users (email, name, balance)
       VALUES ($1, $2, $3)
       ON CONFLICT ((lower(email))) DO UPDATE
         SET name = EXCLUDED.name,
             balance = EXCLUDED.balance
       RETURNING id, email, name, balance, created_at`,
      [input.email, input.name, input.balance ?? 0],
    );
    return result.rows[0];
  }
}
