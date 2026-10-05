import { createServerFn } from '@tanstack/react-start'
import { sql } from 'drizzle-orm'
import {
  overReceiveWorklistInputSchema,
  pushInputSchema,
} from '~/shared/schemas'
import { getDb } from '../db/client'
import { UNAUTHORIZED_MESSAGE, assertAuthorizedDevice } from '../services/auth-service'
import { overReceiveWorklist, syncPush } from '../services/sync-service'

/** FR-5.x — Synchronize receiving sessions to central database (device auth is checked inside syncPush). */
export const syncPushFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => pushInputSchema.parse(data))
  .handler(async ({ data }) => {
    try {
      return await syncPush(data)
    } catch (error) {
      // Per-session errors are already handled inside syncPush; this only catches
      // failures before the session loop (e.g. database unreachable).
      console.error('[sync] push gagal:', error)
      throw new Error('Server gagal memproses sinkronisasi. Coba lagi beberapa saat lagi.')
    }
  })

/** FR-6.4 — Over-receive worklist (for admin verification/demo). Requires a valid device credential. */
export const overReceiveWorklistFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => overReceiveWorklistInputSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    try {
      await assertAuthorizedDevice(data.credentials)
      return await overReceiveWorklist(getDb(), data.limit)
    } catch (error) {
      // The "not authenticated" message is meant for the user; anything else is
      // internal (SQL, host) and stays in the server log only.
      if (error instanceof Error && error.message === UNAUTHORIZED_MESSAGE) throw error
      console.error('[sync] worklist gagal:', error)
      throw new Error('Server gagal menyiapkan data. Coba lagi beberapa saat lagi.')
    }
  })

/** Database connection health check. Deliberately returns no configuration details. */
export const healthFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    await getDb().execute(sql`SELECT 1 AS ok`)
  } catch (error) {
    console.error('[health] database tidak dapat dijangkau:', error)
    throw new Error('Database tidak dapat dijangkau.')
  }
  return {
    ok: true,
    serverTime: new Date().toISOString(),
  }
})
