import { createServerFn } from '@tanstack/react-start'
import { pullInputSchema } from '~/shared/schemas'
import { pullChunk } from '../services/pull-service'

/**
 * FR-2.1 / FR-2.3 / NF-4 — Paginated download of master data & CHECKED POs.
 * BR-13 — without location filter.
 */
export const pullDataFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => pullInputSchema.parse(data))
  .handler(async ({ data }) => pullChunk(data.kind, data.offset, data.limit))
