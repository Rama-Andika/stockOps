import { createServerFn } from '@tanstack/react-start'
import { pullInputSchema } from '~/shared/schemas'
import { pullChunk } from '../services/pull-service'

/**
 * FR-2.1 / FR-2.3 / NF-4 — Unduh data master & PO CHECKED secara bertahap.
 * BR-13 — tanpa filter lokasi.
 */
export const pullDataFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => pullInputSchema.parse(data))
  .handler(async ({ data }) => pullChunk(data.kind, data.offset, data.limit))
