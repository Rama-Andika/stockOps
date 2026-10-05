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
 * Transport abstraction to server. The application uses `serverTransport`
 * (TanStack Start server functions); tests may inject a mock transport
 * that calls the server services directly.
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
