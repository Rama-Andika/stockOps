import { overReceiveWorklistFn } from '~/server/functions/sync'
import type { CredentialFingerprint, OverReceiveWorklistRow } from '~/shared/schemas'

/**
 * Read-only admin/supervisor queries. Deliberately separate from `SyncTransport`, which is
 * re-implemented by mock transports in the tests: adding a required member there would break
 * every one of them.
 */
export interface AdminTransport {
  overReceiveWorklist(input: {
    limit: number
    credentials: CredentialFingerprint[]
  }): Promise<OverReceiveWorklistRow[]>
}

export const serverAdminTransport: AdminTransport = {
  overReceiveWorklist: (input) => overReceiveWorklistFn({ data: input }),
}
