import { createServerFn } from '@tanstack/react-start'
import { sql } from 'drizzle-orm'
import {
  overReceiveWorklistInputSchema,
  pushInputSchema,
} from '~/shared/schemas'
import { getDb } from '../db/client'
import { serverEnv } from '../env'
import { overReceiveWorklist, syncPush } from '../services/sync-service'

/** FR-5.x — Sinkronisasi sesi penerimaan ke database pusat. */
export const syncPushFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => pushInputSchema.parse(data))
  .handler(async ({ data }) => syncPush(data))

/** FR-6.4 — Worklist over-receive (untuk verifikasi admin/demo). */
export const overReceiveWorklistFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => overReceiveWorklistInputSchema.parse(data ?? {}))
  .handler(async ({ data }) => overReceiveWorklist(getDb(), data.limit))

/** Pemeriksaan kesehatan koneksi database (dipakai indikator koneksi). */
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
