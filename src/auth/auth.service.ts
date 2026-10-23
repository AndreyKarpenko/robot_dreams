import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient } from 'pg';
import { Env } from '../config/env.schema';
import { PG_POOL } from '../db/database.module';
import { UsersRepository } from '../users/users.repository';
import {
  ACCESS_TTL_SEC,
  REFRESH_TTL_SEC,
  signAccessToken,
  TokenError,
  verifyAccessToken,
  type AccessClaims,
} from './jwt';
import { loadSigningKeys, type SigningKeys } from './keys';
import { verifyPassword } from './password';
import { isUserRole } from './roles';

export type TokenPair = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: 'Bearer';
};

type RefreshRow = {
  id: string;
  family_id: string;
  user_id: string;
  used_at: Date | null;
  revoked_at: Date | null;
  expired: boolean;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly keys: SigningKeys;
  private readonly pepper: string;

  constructor(
    config: ConfigService<Env, true>,
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly users: UsersRepository,
  ) {
    this.keys = loadSigningKeys({
      JWT_KID: config.get('JWT_KID', { infer: true }),
      JWT_PRIVATE_KEY: config.get('JWT_PRIVATE_KEY', { infer: true }),
      JWT_PUBLIC_KEY: config.get('JWT_PUBLIC_KEY', { infer: true }),
    });
    this.pepper = config.get('REFRESH_TOKEN_PEPPER', { infer: true });
  }

  async login(email: string, password: string): Promise<TokenPair> {
    const user = await this.users.findForLogin(email);
    const passwordOk =
      user?.password_hash != null &&
      (await verifyPassword(password, user.password_hash));
    if (!user || !passwordOk || !isUserRole(user.role)) {
      throw new UnauthorizedException();
    }
    return this.issueFamily(user.id, user.role);
  }

  async refresh(rawToken: string): Promise<TokenPair> {
    const outcome = await this.inTransaction(async (client) => {
      const peeked = await client.query<{ family_id: string }>(
        `SELECT family_id FROM refresh_tokens WHERE token_hash = $1`,
        [this.hashRefresh(rawToken)],
      );
      const familyId = peeked.rows[0]?.family_id;
      if (!familyId) {
        return { ok: false as const };
      }
      // Family lock before the row lock, same order as logout, so the two
      // cannot deadlock on each other's FOR UPDATE.
      await this.lockFamily(client, familyId);
      const row = await this.lockRefresh(client, rawToken);
      if (!row || row.revoked_at || row.expired) {
        return { ok: false as const };
      }
      const familyDead = await client.query(
        `SELECT 1 FROM refresh_tokens
          WHERE family_id = $1 AND revoked_at IS NOT NULL
          LIMIT 1`,
        [row.family_id],
      );
      if ((familyDead.rowCount ?? 0) > 0) {
        await this.revokeFamily(client, row.family_id);
        return { ok: false as const };
      }
      if (row.used_at) {
        await this.revokeFamily(client, row.family_id);
        return { ok: false as const, reuseFamilyId: row.family_id };
      }

      const marked = await client.query(
        `UPDATE refresh_tokens
            SET used_at = now()
          WHERE id = $1 AND used_at IS NULL`,
        [row.id],
      );
      if ((marked.rowCount ?? 0) !== 1) {
        await this.revokeFamily(client, row.family_id);
        return { ok: false as const, reuseFamilyId: row.family_id };
      }

      const account = await client.query<{ id: string; role: string }>(
        `SELECT id, role FROM users WHERE id = $1`,
        [row.user_id],
      );
      const current = account.rows[0];
      if (!current || !isUserRole(current.role)) {
        return { ok: false as const };
      }
      const pair = await this.insertRefresh(client, {
        userId: current.id,
        role: current.role,
        familyId: row.family_id,
      });
      return { ok: true as const, pair };
    });

    if (!outcome.ok) {
      if ('reuseFamilyId' in outcome) {
        this.logger.warn(`refresh reuse family_id=${outcome.reuseFamilyId}`);
      }
      throw new UnauthorizedException();
    }
    return outcome.pair;
  }

  /**
   * Logout writes the refresh-family revoke and the access denylist in one
   * commit. Splitting them across Postgres and Redis would be a dual write.
   */
  async logout(user: AccessClaims): Promise<void> {
    await this.inTransaction(async (client) => {
      await this.lockFamily(client, user.familyId);
      await this.revokeFamily(client, user.familyId);
      await client.query(
        `DELETE FROM access_denylist WHERE expires_at <= now()`,
      );
      await client.query(
        `INSERT INTO access_denylist (jti, expires_at)
         VALUES ($1, to_timestamp($2))
         ON CONFLICT (jti) DO UPDATE
           SET expires_at = EXCLUDED.expires_at`,
        [user.jti, user.exp],
      );
    });
  }

  async authenticate(token: string): Promise<AccessClaims> {
    let claims: AccessClaims;
    try {
      claims = verifyAccessToken(token, this.keys.publicKeys);
    } catch (err) {
      if (err instanceof TokenError) {
        throw new UnauthorizedException();
      }
      throw err;
    }
    const denied = await this.pool.query(
      `WITH gone AS (
         DELETE FROM access_denylist
          WHERE jti = $1 AND expires_at <= now()
       )
       SELECT 1 FROM access_denylist
        WHERE jti = $1 AND expires_at > now()`,
      [claims.jti],
    );
    if ((denied.rowCount ?? 0) > 0) {
      throw new UnauthorizedException();
    }
    return claims;
  }

  private async issueFamily(
    userId: string,
    role: AccessClaims['role'],
  ): Promise<TokenPair> {
    const familyId = randomUUID();
    return this.inTransaction((client) =>
      this.insertRefresh(client, { userId, role, familyId }),
    );
  }

  private async insertRefresh(
    client: PoolClient,
    input: { userId: string; role: AccessClaims['role']; familyId: string },
  ): Promise<TokenPair> {
    const raw = randomBytes(32).toString('base64url');
    const jti = randomUUID();
    const signed = signAccessToken(
      {
        userId: input.userId,
        role: input.role,
        jti,
        familyId: input.familyId,
      },
      this.keys.kid,
      this.keys.privateKey,
    );
    await client.query(
      `INSERT INTO refresh_tokens (token_hash, family_id, user_id, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(secs => $4::int))`,
      [this.hashRefresh(raw), input.familyId, input.userId, REFRESH_TTL_SEC],
    );
    return {
      access_token: signed.token,
      refresh_token: raw,
      expires_in: ACCESS_TTL_SEC,
      token_type: 'Bearer',
    };
  }

  private hashRefresh(raw: string): string {
    return createHmac('sha256', this.pepper).update(raw).digest('base64url');
  }

  private async lockRefresh(
    client: PoolClient,
    rawToken: string,
  ): Promise<RefreshRow | null> {
    const result = await client.query<RefreshRow>(
      `SELECT id, family_id, user_id, used_at, revoked_at,
              (expires_at <= now()) AS expired
         FROM refresh_tokens
        WHERE token_hash = $1
        FOR UPDATE`,
      [this.hashRefresh(rawToken)],
    );
    return result.rows[0] ?? null;
  }

  private async lockFamily(client: PoolClient, familyId: string): Promise<void> {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
      [familyId],
    );
  }

  private async revokeFamily(
    client: PoolClient,
    familyId: string,
  ): Promise<void> {
    await client.query(
      `UPDATE refresh_tokens
          SET revoked_at = now()
        WHERE family_id = $1 AND revoked_at IS NULL`,
      [familyId],
    );
  }

  private async inTransaction<T>(
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // The original error is the one the caller needs.
      }
      throw err;
    } finally {
      client.release();
    }
  }
}
