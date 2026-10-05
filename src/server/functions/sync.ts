import { createServerFn } from '@tanstack/react-start'
import { sql } from 'drizzle-orm'
import {
  overReceiveWorklistInputSchema,
  pushInputSchema,
} from '~/shared/schemas'
import { getDb } from '../db/client'
import { serverEnv } from '../env'
import { overReceiveWorklist, syncPush } from '../services/sync-service'

/** FR-5.x — Synchronize receiving sessions to central database. */
export const syncPushFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => pushInputSchema.parse(data))
  .handler(async ({ data }) => syncPush(data))

/** FR-6.4 — Over-receive worklist (for admin verification/demo). */
export const overReceiveWorklistFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => overReceiveWorklistInputSchema.parse(data ?? {}))
  .handler(async ({ data }) => overReceiveWorklist(getDb(), data.limit))

/** Database connection health check (used by connection indicator). */
export const healthFn = createServerFn({ method: 'GET' }).handler(async () => {
  const db = getDb()
  await db.execute(sql`SELECT 1 AS ok`)
  return {
    ok: true,
    database: serverEnv.database,
    pdtAppIdx: serverEnv.pdtAppIdx,
    serverTime: new Date().toISOString(),
  }
})
