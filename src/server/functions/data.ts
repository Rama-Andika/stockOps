import { createServerFn } from '@tanstack/react-start'
import { pullInputSchema } from '~/core/contracts/schemas'
import { UNAUTHORIZED_MESSAGE, assertAuthorizedDevice } from '~/server/services/auth-service'
import { pullChunk } from '~/server/services/pull-service'

/**
 * Chunked download of master data and receivable POs, used both for the full first pull and
 * for refreshing the PO list later. Chunked because a first pull is around 50k items.
 *
 * Every CHECKED PO is sent, with no filter by warehouse location — that filter is a known gap,
 * not an oversight, so expect a device to hold POs for locations it will never receive.
 *
 * Reads ERP data, so it demands a still-valid cached credential (assertAuthorizedDevice). Any
 * new server function that touches ERP data has to do the same.
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
