/**
 * Skema ID sistem admin (BR-8, BR-12, BR-17).
 *
 * Rumus asli sistem admin (Java):
 *   receiveId = (millis + 2^56 * appIdx) * 10 + digitAcak
 *
 * Nilai 2^56 memisahkan "namespace" antar index aplikasi sehingga ID yang
 * dibuat aplikasi PDT (appIdx = 2) tidak mungkin bertabrakan dengan ID yang
 * dibuat website admin (appIdx = 1).
 *
 * PENTING: hasil selalu berupa `bigint`. Nilainya jauh di atas Number.MAX_SAFE_INTEGER
 * (2^53), sehingga TIDAK BOLEH dikonversi menjadi Number tanpa kehilangan presisi (BR-12).
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

/** Menyusun ID mentah dari komponennya (replika rumus Java). */
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

/** Membalik ID menjadi komponennya (dipakai untuk verifikasi & audit). */
export function decomposeId(id: bigint): IdParts {
  const digit = Number(id % 10n)
  const base = id / 10n
  const appIdx = Number(base / TWO_POW_56)
  const millis = Number(base % TWO_POW_56)
  return { appIdx, millis, digit }
}

/** ID terkecil yang mungkin untuk sebuah appIdx (untuk menyempitkan query). */
export function minIdForApp(appIdx: number): bigint {
  assertAppIdx(appIdx)
  return TWO_POW_56 * BigInt(appIdx) * 10n
}

/** ID terbesar yang mungkin untuk sebuah appIdx (1 namespace lebih kecil dari appIdx+1). */
export function maxIdForApp(appIdx: number): bigint {
  assertAppIdx(appIdx)
  return TWO_POW_56 * BigInt(appIdx + 1) * 10n - 1n
}

export type NowFn = () => number
export type RandomFn = () => number

/**
 * Generator ID yang aman dipakai bersamaan (multi-device menulis ke server
 * yang sama) dan dijamin unik secara monotonik dalam satu proses.
 *
 * Java asli memakai `synchronized` + `Thread.sleep` karena ID hanya dijamin
 * unik di level satu JVM. Di sini kita memakai counter millis monotonik,
 * yang aman untuk beberapa request dalam proses yang sama. Tiap instance
 * diberi appIdx berbeda untuk memisahkan namespace penulis (BR-17).
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
    // Pastikan millis selalu naik, sehingga dua pemanggilan berurutan
    // tidak pernah menghasilkan ID yang sama walaupun jam yang sama.
    if (millis <= this.lastMillis) {
      millis = this.lastMillis + 1
    }
    this.lastMillis = millis
    const digit = Math.floor(this.random() * 10)
    return composeId(this.appIdx, millis, Math.min(9, Math.max(0, digit)))
  }

  /** Nilai terakhir yang memakai millis yang sama (untuk debugging/audit). */
  get lastMillisUsed(): number {
    return this.lastMillis
  }
}

/** Selalu tampilkan/angkut bigint sebagai string (BR-12). */
export function idToString(id: bigint): string {
  return id.toString()
}
