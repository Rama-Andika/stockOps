/**
 * The admin system's ID scheme, which this app has to honour rather than invent its own.
 *
 * Formula, copied from the admin system (Java):
 *   receiveId = (millis + 2^56 * appIdx) * 10 + randomDigit
 *
 * The 2^56 term partitions the ID space per writing application, so IDs minted by this app
 * (appIdx = 2) can never land inside the range the admin website mints from (appIdx = 1).
 * Both write to the same tables with no shared sequence, so the namespace split is the only
 * thing preventing a primary-key collision — which is why the PDT appIdx is validated at
 * start-up instead of being trusted.
 *
 * IMPORTANT: the result is always a `bigint`. These values sit far above
 * Number.MAX_SAFE_INTEGER (2^53), so converting one to `number` silently corrupts its last
 * digits — the row then points at a record that does not exist, or worse, at the wrong one.
 * Every ID stays a string or a BigInt from the database to the UI and back.
 */

export const TWO_POW_56 = 1n << 56n

export interface IdParts {
  appIdx: number
  millis: number
  digit: number
}

export function assertAppIdx(appIdx: number): void {
  if (!Number.isInteger(appIdx) || appIdx < 0) {
    throw new Error(`appIdx harus berupa integer >= 0 (diterima: ${appIdx})`)
  }
}

/** Composes raw ID from its components (replicating Java formula). */
export function composeId(appIdx: number, millis: number, digit: number): bigint {
  assertAppIdx(appIdx)
  if (!Number.isInteger(millis) || millis < 0) {
    throw new Error(`millis harus berupa integer >= 0 (diterima: ${millis})`)
  }
  if (!Number.isInteger(digit) || digit < 0 || digit > 9) {
    throw new Error(`digit harus integer 0..9 (diterima: ${digit})`)
  }
  return (BigInt(millis) + TWO_POW_56 * BigInt(appIdx)) * 10n + BigInt(digit)
}

/** Decomposes ID into its components (used for verification & auditing). */
export function decomposeId(id: bigint): IdParts {
  const digit = Number(id % 10n)
  const base = id / 10n
  const appIdx = Number(base / TWO_POW_56)
  const millis = Number(base % TWO_POW_56)
  return { appIdx, millis, digit }
}

/** Smallest possible ID for a given appIdx (to narrow queries). */
export function minIdForApp(appIdx: number): bigint {
  assertAppIdx(appIdx)
  return TWO_POW_56 * BigInt(appIdx) * 10n
}

/** Largest possible ID for a given appIdx (1 namespace unit smaller than appIdx+1). */
export function maxIdForApp(appIdx: number): bigint {
  assertAppIdx(appIdx)
  return TWO_POW_56 * BigInt(appIdx + 1) * 10n - 1n
}

export type NowFn = () => number
export type RandomFn = () => number

/**
 * Concurrency-safe ID generator (multi-device writing to the same
 * server) guaranteed to be monotonically unique within a single process.
 *
 * The original Java implementation uses `synchronized` + `Thread.sleep`, because its IDs are
 * only unique within one JVM. Here a monotonic millis counter does the same job and holds
 * across concurrent requests in the same process. Uniqueness against the OTHER writer — the
 * admin website — does not come from this counter at all but from each instance owning a
 * distinct appIdx, so never construct one with admin's index.
 */
export class IdGenerator {
  private lastMillis: number

  constructor(
    private readonly appIdx: number,
    private readonly now: NowFn = Date.now,
    private readonly random: RandomFn = Math.random,
  ) {
    assertAppIdx(appIdx)
    this.lastMillis = now()
  }

  next(): bigint {
    let millis = this.now()
    // Ensure millis is strictly increasing so two sequential invocations
    // never produce the same ID even within the same clock millisecond.
    if (millis <= this.lastMillis) {
      millis = this.lastMillis + 1
    }
    this.lastMillis = millis
    const digit = Math.floor(this.random() * 10)
    return composeId(this.appIdx, millis, Math.min(9, Math.max(0, digit)))
  }

  /** Last millisecond value used (for debugging/audit). */
  get lastMillisUsed(): number {
    return this.lastMillis
  }
}

/**
 * The one way an ID leaves this process: as a string. JSON has no bigint, and letting it be
 * serialized as a number would round away its last digits.
 */
export function idToString(id: bigint): string {
  return id.toString()
}
