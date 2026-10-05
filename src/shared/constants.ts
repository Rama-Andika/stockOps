/** Shared domain constants (used by server & client). */

export const PURCHASE_STATUS = {
  DRAFT: 'DRAFT',
  CHECKED: 'CHECKED',
  APPROVED: 'APPROVED',
  CLOSED: 'CLOSED',
} as const

export type PurchaseStatus = (typeof PURCHASE_STATUS)[keyof typeof PURCHASE_STATUS]

/** BR-1: only CHECKED POs are pulled & allowed to be processed. */
export const PULLABLE_PURCHASE_STATUS = PURCHASE_STATUS.CHECKED

/** BR-2: receiving documents from PDT are always DRAFT. */
export const RECEIVE_STATUS_DRAFT = 'DRAFT'

/** FR-7.3: session status on device. */
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
 * Server failure codes that are PERMANENT: the session is rejected & cannot
 * be retried (e.g., PO closed/deleted, or invalid items).
 */
export const PERMANENT_REJECT_CODES: readonly string[] = [
  'PURCHASE_NOT_FOUND',
  'PURCHASE_NOT_CHECKED',
  'VALIDATION',
]

/** FR-3.2: PO progress status. */
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

/** Chunk size when pulling master data (NF-4). */
export const DEFAULT_PULL_CHUNK_SIZE = 500

/**
 * Local `meta` key: '1' when the PO list could not be refreshed after a sync (e.g. an
 * IDEMPOTENT_REPLAY) and must be retried; '0' once a refresh/download succeeded.
 */
export const PURCHASES_STALE_META_KEY = 'purchasesStale'

/** Max sessions per push request (validated by the server, enforced by the client outbox). */
export const MAX_PUSH_SESSIONS = 200

/** Max lines per receiving session in a push request. */
export const MAX_SESSION_LINES = 5000

/** Master data TTL (hours) before considered stale & re-downloaded upon online login (FR-2.1). */
export const MASTER_DATA_STALE_HOURS = 12

/** Column length limit for memo (pos_receive_item.memo = varchar(120)). */
export const MEMO_MAX_LENGTH = 120

/** PDT session marker convention on pos_receive.note column (idempotency, FR-5.3). */
export const NOTE_SESSION_PREFIX = 'PDT|SESS='
/** Over-receive marker convention on pos_receive_item.memo column (FR-6.2). */
export const MEMO_OVER_PREFIX = 'PDT|OVER'

export const DEVICE_ID_STORAGE_KEY = 'stockops.deviceId'

/** Safe upper bound for ID node to fit in a bigint(20) column. */
export const MAX_BIGINT = 9223372036854775807n
