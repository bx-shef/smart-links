import { dbEnabled, getPool } from '../db/client'
import { SCHEMA_SQL } from '../db/schema'

// Idempotent schema migration on boot (no-op without DATABASE_URL / at prerender), so the app
// runs fine with or without a database. Adapted from ai-price-import.
export default defineNitroPlugin(async () => {
  if (import.meta.prerender || !dbEnabled()) {
    return
  }
  try {
    await getPool().query(SCHEMA_SQL)
    console.info('[db] schema ensured')
  } catch (err) {
    console.error('[db] migration failed', (err as Error).message)
  }
})
