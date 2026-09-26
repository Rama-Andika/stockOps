import { loginOnlineFn, checkCredentialsFn } from '~/server/functions/auth'
import { pullDataFn } from '~/server/functions/data'
import { syncPushFn } from '~/server/functions/sync'
import type {
  CheckCredentialsResult,
  CredentialFingerprint,
  LoginResult,
  PullKind,
  PullResult,
  PushInput,
  PushResult,
} from '~/shared/schemas'

/**
 * Abstraksi transport ke server. Aplikasi memakai `serverTransport`
 * (TanStack Start server functions); test boleh menyuntik transport palsu
 * yang memanggil service server secara langsung.
 */
export interface SyncTransport {
  login(input: { loginId: string; password: string; deviceId: string }): Promise<LoginResult>
  checkCredentials(input: {
    credentials: CredentialFingerprint[]
  }): Promise<CheckCredentialsResult>
  pull(input: { kind: PullKind; offset: number; limit: number }): Promise<PullResult>
  push(input: PushInput): Promise<PushResult>
}

export const serverTransport: SyncTransport = {
  login: (input) => loginOnlineFn({ data: input }),
  checkCredentials: (input) => checkCredentialsFn({ data: input }),
  pull: (input) => pullDataFn({ data: input }),
  push: (input) => syncPushFn({ data: input }),
}
