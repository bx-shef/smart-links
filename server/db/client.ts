import { Pool } from 'pg'
import type { QueryFn } from './query'

// Lazy pooled pg client. No-op-safe: getPool() throws only when actually used without
// DATABASE_URL, so prerender/tests never need a DB. Adapted from ai-price-import.

let pool: Pool | null = null

export function getPool(): Pool {
  if (pool) {
    return pool
  }
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL is not set')
  }
  pool = new Pool({ connectionString: url, max: 5 })
  // A dropped idle connection must not crash the process.
  pool.on('error', err => console.error('[db] idle client error', err.message))
  return pool
}

/** A QueryFn bound to the pool — inject this into the pure stores. */
export const query: QueryFn = async (sql, params) => {
  const res = await getPool().query(sql, params as unknown[])
  return { rows: res.rows as Array<Record<string, unknown>> }
}

/** True when a database is configured. When false the rating routes stay inert ({show:false}). */
export function dbEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL)
}
