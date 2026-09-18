import type { Pool, PoolClient } from 'pg';

/** Pool or a client from an open transaction — anything with `query()`. */
export type Queryable = Pool | PoolClient;
