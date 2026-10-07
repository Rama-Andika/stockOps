import { createServerFn } from '@tanstack/react-start'
import { checkCredentialsInputSchema, loginInputSchema } from '~/shared/schemas'
import { checkCredentialRevocations, loginOnline } from '../services/auth-service'

/**
 * Online login. Required the first time a user signs in on a device, because it is the only
 * moment the server can hand out the password fingerprint the device then caches for offline
 * logins. `checkCredentialsFn` is the other half: at every sync the device asks whether any
 * of its cached credentials has been revoked in the meantime.
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
