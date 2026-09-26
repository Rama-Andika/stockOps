import { createServerFn } from '@tanstack/react-start'
import { checkCredentialsInputSchema, loginInputSchema } from '~/shared/schemas'
import { checkCredentialRevocations, loginOnline } from '../services/auth-service'

/**
 * FR-1.1 — Login online pertama di sebuah device.
 * FR-1.6/BR-19 — Cek pencabutan kredensial untuk semua user ter-cache.
 */
export const loginOnlineFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => loginInputSchema.parse(data))
  .handler(async ({ data }) => loginOnline(data))

export const checkCredentialsFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => checkCredentialsInputSchema.parse(data))
  .handler(async ({ data }) => ({ revoked: await checkCredentialRevocations(data.credentials) }))
