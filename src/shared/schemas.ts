/**
 * Kontrak data (Zod) untuk server functions dan payload sinkronisasi.
 * Semua kolom bigint selalu diangkut sebagai string (BR-12).
 */

import { z } from 'zod'

export const bigintString = z
  .string()
  .trim()
  .regex(/^\d+$/, 'harus berupa string angka (bigint)')

export const nullableBigintString = bigintString.nullish()

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export const loginInputSchema = z.object({
  loginId: z.string().trim().min(1, 'ID wajib diisi').max(20),
  password: z.string().min(1, 'Password wajib diisi').max(64),
  deviceId: z.string().trim().min(1).max(64),
})

export const userIdentitySchema = z.object({
  userId: bigintString,
  loginId: z.string(),
  fullName: z.string(),
  companyId: bigintString,
})

export type UserIdentity = z.infer<typeof userIdentitySchema>

export const loginResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    user: userIdentitySchema,
    fingerprint: z.string(),
    serverTime: z.string(),
    sessionTtlDays: z.number().int().positive(),
  }),
  z.object({
    ok: z.literal(false),
    code: z.enum(['INVALID_CREDENTIALS', 'SERVER_ERROR']),
    message: z.string(),
  }),
])

export type LoginResult = z.infer<typeof loginResultSchema>

export const credentialFingerprintSchema = z.object({
  userId: bigintString,
  loginId: z.string(),
  fingerprint: z.string(),
})

export type CredentialFingerprint = z.infer<typeof credentialFingerprintSchema>

export const checkCredentialsInputSchema = z.object({
  credentials: z.array(credentialFingerprintSchema).max(500),
})

export const checkCredentialsResultSchema = z.object({
  revoked: z.array(
    z.object({
      userId: bigintString,
      reason: z.enum(['CHANGED', 'MISSING']),
    }),
  ),
})

export type CheckCredentialsResult = z.infer<typeof checkCredentialsResultSchema>

/* ------------------------------------------------------------------ */
/* Pull (unduh data master & PO)                                       */
/* ------------------------------------------------------------------ */

export const PULL_KINDS = [
  'purchases',
  'purchaseItems',
  'items',
  'units',
  'vendors',
  'vendorItems',
] as const

export type PullKind = (typeof PULL_KINDS)[number]

export const pullInputSchema = z.object({
  kind: z.enum(PULL_KINDS),
  offset: z.number().int().min(0),
  limit: z.number().int().min(1).max(2000),
})

export const purchaseRowSchema = z.object({
  purchaseId: bigintString,
  number: z.string().nullish(),
  status: z.string().nullish(),
  vendorId: bigintString,
  vendorName: z.string(),
  locationId: bigintString,
  userId: bigintString,
  companyId: bigintString,
  purchDate: z.string().nullish(),
  totalAmount: z.string(),
})

export const purchaseItemRowSchema = z.object({
  purchaseItemId: bigintString,
  purchaseId: bigintString,
  itemMasterId: bigintString,
  qty: z.string(),
  uomId: bigintString,
  receivedQty: z.string(),
})

export const itemRowSchema = z.object({
  itemMasterId: bigintString,
  code: z.string().nullish(),
  barcode: z.string().nullish(),
  barcode2: z.string().nullish(),
  barcode3: z.string().nullish(),
  name: z.string(),
  uomStockId: bigintString,
  uomPurchaseId: bigintString,
})

export const unitRowSchema = z.object({
  uomId: bigintString,
  unit: z.string(),
})

export const vendorRowSchema = z.object({
  vendorId: bigintString,
  code: z.string().nullish(),
  name: z.string(),
  dueDate: z.string().nullish(),
})

export const vendorItemRowSchema = z.object({
  vendorItemId: bigintString,
  vendorId: bigintString,
  itemMasterId: bigintString,
  uomPurchase: bigintString,
  convQty: z.string(),
})

export const pullCellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])

export type PullCell = z.infer<typeof pullCellSchema>

export const pullResultSchema = z.object({
  kind: z.enum(PULL_KINDS),
  offset: z.number().int().min(0),
  nextOffset: z.number().int().min(0).nullable(),
  total: z.number().int().min(0),
  // Nilai baris selalu berupa primitif yang aman diserialisasi (BR-12: bigint = string).
  rows: z.array(z.record(z.string(), pullCellSchema)),
  pulledAt: z.string(),
})

export type PullResult = z.infer<typeof pullResultSchema>

/* ------------------------------------------------------------------ */
/* Push (sinkronisasi sesi penerimaan)                                 */
/* ------------------------------------------------------------------ */

export const receiveLineInputSchema = z.object({
  clientLineId: z.string().min(1).max(64),
  purchaseItemId: bigintString,
  itemMasterId: bigintString,
  qty: z.number().positive('qty harus > 0'),
  uomPurchaseId: bigintString,
  uomId: bigintString,
  convQty: z.number().positive(),
  convFound: z.boolean(),
})

export type ReceiveLineInput = z.infer<typeof receiveLineInputSchema>

export const receiveSessionInputSchema = z.object({
  sessionId: z.string().trim().min(8).max(64),
  deviceId: z.string().trim().min(1).max(64),
  userId: bigintString,
  purchaseId: bigintString,
  vendorId: bigintString,
  locationId: bigintString,
  companyId: bigintString,
  receiveDate: z.string().min(1),
  dueDate: z.string().nullish(),
  invoiceNumber: z.string().trim().min(1, 'Nomor invoice wajib').max(45),
  doNumber: z.string().trim().min(1, 'Nomor DO wajib').max(45),
  finalizedAt: z.string().min(1),
  items: z.array(receiveLineInputSchema).min(1, 'Minimal 1 item'),
})

export type ReceiveSessionInput = z.infer<typeof receiveSessionInputSchema>

export const pushInputSchema = z.object({
  deviceId: z.string().trim().min(1).max(64),
  sessions: z.array(receiveSessionInputSchema).min(1),
  credentials: z.array(credentialFingerprintSchema).max(500).default([]),
})

export type PushInput = z.infer<typeof pushInputSchema>

export const syncLineResultSchema = z.object({
  clientLineId: z.string(),
  purchaseItemId: bigintString,
  orderedQty: z.number(),
  previousQty: z.number(),
  sessionQty: z.number(),
  newTotal: z.number(),
  overReceive: z.boolean(),
  excess: z.number(),
  memo: z.string().nullish(),
})

export type SyncLineResult = z.infer<typeof syncLineResultSchema>

export const syncSessionResultSchema = z.object({
  sessionId: z.string(),
  status: z.enum(['SYNCED', 'FAILED']),
  receiveId: bigintString.nullish(),
  number: z.string().nullish(),
  overReceive: z.boolean(),
  excessTotal: z.number(),
  lines: z.array(syncLineResultSchema),
  code: z
    .enum(['OK', 'IDEMPOTENT_REPLAY', 'PURCHASE_NOT_FOUND', 'PURCHASE_NOT_CHECKED', 'VALIDATION', 'SERVER_ERROR'])
    .optional(),
  message: z.string().nullish(),
})

export type SyncSessionResult = z.infer<typeof syncSessionResultSchema>

export const pushResultSchema = z.object({
  results: z.array(syncSessionResultSchema),
  revoked: checkCredentialsResultSchema.shape.revoked,
  serverTime: z.string(),
})

export type PushResult = z.infer<typeof pushResultSchema>

/* ------------------------------------------------------------------ */
/* Worklist admin (untuk verifikasi & demo)                            */
/* ------------------------------------------------------------------ */

export const overReceiveWorklistInputSchema = z.object({
  limit: z.number().int().min(1).max(200).default(50),
})

export const overReceiveWorklistRowSchema = z.object({
  receiveId: bigintString,
  number: z.string().nullish(),
  receiveItemId: bigintString,
  purchaseId: bigintString,
  purchaseNumber: z.string().nullish(),
  vendorName: z.string(),
  itemMasterId: bigintString,
  itemName: z.string(),
  orderedQty: z.number(),
  newTotal: z.number(),
  excess: z.number(),
  memo: z.string(),
})

export type OverReceiveWorklistRow = z.infer<typeof overReceiveWorklistRowSchema>
