import { createServerFn } from '@tanstack/react-start'
import { pullInputSchema } from '~/shared/schemas'
import { UNAUTHORIZED_MESSAGE, assertAuthorizedDevice } from '../services/auth-service'
import { pullChunk } from '../services/pull-service'

/**
 * FR-2.1 / FR-2.3 / NF-4 — Paginated download of master data & CHECKED POs.
 * BR-13 — without location filter.
 * Only devices holding a still-valid credential may download (see assertAuthorizedDevice).
 */
export const pullDataFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => pullInputSchema.parse(data))
  .handler(async ({ data }) => {
    try {
      await assertAuthorizedDevice(data.credentials)
      return await pullChunk(data.kind, data.offset, data.limit)
    } catch (error) {
      // The "not authenticated" message is meant for the user; anything else is
      // internal (SQL, host) and stays in the server log only.
      if (error instanceof Error && error.message === UNAUTHORIZED_MESSAGE) throw error
      console.error(`[pull] ${data.kind} gagal:`, error)
      throw new Error('Server gagal menyiapkan data. Coba lagi beberapa saat lagi.')
    }
  })
