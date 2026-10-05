import { createServerFn } from '@tanstack/react-start'
import { checkCredentialsInputSchema, loginInputSchema } from '~/shared/schemas'
import { checkCredentialRevocations, loginOnline } from '../services/auth-service'

/**
 * FR-1.1 — First online login on a device.
 * FR-1.6/BR-19 — Check credential revocation for all cached users.
 */
export const loginOnlineFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => loginInputSchema.parse(data))
  .handler(async ({ data }) => loginOnline(data))

export const checkCredentialsFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => checkCredentialsInputSchema.parse(data))
  .handler(async ({ data }) => {
    try {
      return { revoked: await checkCredentialRevocations(data.credentials) }
    } catch (error) {
      // Internal details (SQL, host) stay in the server log only.
      console.error('[auth] cek kredensial gagal:', error)
      throw new Error('Server gagal memeriksa kredensial. Coba lagi beberapa saat lagi.')
    }
  })
