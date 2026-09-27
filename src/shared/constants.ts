/** Konstanta domain bersama (dipakai server & klien). */

export const PURCHASE_STATUS = {
  DRAFT: 'DRAFT',
  CHECKED: 'CHECKED',
  APPROVED: 'APPROVED',
  CLOSED: 'CLOSED',
} as const

export type PurchaseStatus = (typeof PURCHASE_STATUS)[keyof typeof PURCHASE_STATUS]

/** BR-1: hanya PO CHECKED yang ditarik & boleh diproses. */
export const PULLABLE_PURCHASE_STATUS = PURCHASE_STATUS.CHECKED

/** BR-2: dokumen penerimaan dari PDT selalu DRAFT. */
export const RECEIVE_STATUS_DRAFT = 'DRAFT'

/** FR-7.3: status sesi di device. */
export const SESSION_STATUS = {
  RUNNING: 'RUNNING',
  PENDING: 'PENDING',
  SYNCING: 'SYNCING',
  SYNCED: 'SYNCED',
  FAILED: 'FAILED',
  REJECTED: 'REJECTED',
} as const

export type SessionStatus = (typeof SESSION_STATUS)[keyof typeof SESSION_STATUS]

export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  RUNNING: 'Berjalan',
  PENDING: 'Menunggu Sinkronisasi',
  SYNCING: 'Sedang Dikirim',
  SYNCED: 'Tersinkron',
  FAILED: 'Gagal',
  REJECTED: 'Ditolak',
}

/**
 * Kode kegagalan server yang bersifat PERMANEN: sesi ditolak & tidak bisa
 * dicoba ulang (mis. PO ditutup/dihapus, atau item tidak valid).
 */
export const PERMANENT_REJECT_CODES: readonly string[] = [
  'PURCHASE_NOT_FOUND',
  'PURCHASE_NOT_CHECKED',
  'VALIDATION',
]

/** FR-3.2: status kemajuan PO. */
export const PROGRESS_STATUS = {
  NONE: 'NONE',
  PARTIAL: 'PARTIAL',
  FULL: 'FULL',
  OVER: 'OVER',
} as const

export type ProgressStatus = (typeof PROGRESS_STATUS)[keyof typeof PROGRESS_STATUS]

export const PROGRESS_LABEL: Record<ProgressStatus, string> = {
  NONE: 'Belum diterima',
  PARTIAL: 'Sebagian',
  FULL: 'Lengkap',
  OVER: 'Lebih',
}

/** Ukuran chunk saat unduh data master (NF-4). */
export const DEFAULT_PULL_CHUNK_SIZE = 500

/** Batas umur data master (jam) sebelum dianggap kedaluwarsa & diunduh ulang saat login online (FR-2.1). */
export const MASTER_DATA_STALE_HOURS = 12

/** Batas panjang kolom memo (pos_receive_item.memo = varchar(120)). */
export const MEMO_MAX_LENGTH = 120

/** Konvensi penanda sesi PDT pada kolom pos_receive.note (idempotensi, FR-5.3). */
export const NOTE_SESSION_PREFIX = 'PDT|SESS='
/** Konvensi penanda over-receive pada kolom pos_receive_item.memo (FR-6.2). */
export const MEMO_OVER_PREFIX = 'PDT|OVER'

export const DEVICE_ID_STORAGE_KEY = 'stockops.deviceId'

/** Batas aman simpul ID agar tetap muat di kolom bigint(20). */
export const MAX_BIGINT = 9223372036854775807n
