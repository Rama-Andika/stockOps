/**
 * Konvensi penandaan pada kolom yang SUDAH ADA (BR-18: tanpa mengubah schema).
 *
 * 1. `pos_receive.note`         -> penanda sesi PDT (kunci idempotensi, FR-5.3)
 * 2. `pos_receive_item.memo`    -> penanda over-receive (FR-6.2)
 *
 * Format sengaja dibuat stabil & mudah di-parse agar tim admin dapat memakainya
 * untuk worklist persetujuan.
 */

import { MEMO_MAX_LENGTH, MEMO_OVER_PREFIX, NOTE_SESSION_PREFIX } from './constants'
import { dec2 } from './num'

export interface SessionNote {
  sessionId: string
  deviceId: string
  userId: string
}

export function buildSessionNote(input: SessionNote): string {
  return `${NOTE_SESSION_PREFIX}${input.sessionId};DEV=${input.deviceId};USR=${input.userId}`
}

export function hasSessionMarker(note: string | null | undefined): boolean {
  return typeof note === 'string' && note.includes(NOTE_SESSION_PREFIX)
}

export function parseSessionNote(note: string | null | undefined): SessionNote | null {
  if (typeof note !== 'string') return null
  const start = note.indexOf(NOTE_SESSION_PREFIX)
  if (start < 0) return null
  const payload = note.slice(start + NOTE_SESSION_PREFIX.length)
  const [sessionIdPart] = payload.split(';')
  const sessionId = (sessionIdPart ?? '').trim()
  if (!sessionId) return null
  const deviceMatch = /DEV=([^;]*)/.exec(payload)
  const userMatch = /USR=([^;]*)/.exec(payload)
  return {
    sessionId,
    deviceId: (deviceMatch?.[1] ?? '').trim(),
    userId: (userMatch?.[1] ?? '').trim(),
  }
}

export function extractSessionId(note: string | null | undefined): string | null {
  return parseSessionNote(note)?.sessionId ?? null
}

export interface OverReceiveMemo {
  orderedQty: number
  excess: number
  newTotal: number
}

/** Format: PDT|OVER;ORD=<qty>;TOT=<qty>;EXC=<qty> */
export function buildOverReceiveMemo(input: OverReceiveMemo): string {
  const memo = `${MEMO_OVER_PREFIX};ORD=${dec2(input.orderedQty)};TOT=${dec2(input.newTotal)};EXC=${dec2(input.excess)}`
  return memo.length <= MEMO_MAX_LENGTH ? memo : memo.slice(0, MEMO_MAX_LENGTH)
}

export function isOverReceiveMemo(memo: string | null | undefined): boolean {
  return typeof memo === 'string' && memo.startsWith(MEMO_OVER_PREFIX)
}

export function parseOverReceiveMemo(memo: string | null | undefined): OverReceiveMemo | null {
  if (!isOverReceiveMemo(memo)) return null
  const text = memo as string
  const read = (key: string): number => {
    const match = new RegExp(`${key}=(-?\\d+(?:\\.\\d+)?)`).exec(text)
    return match && match[1] ? Number.parseFloat(match[1]) : 0
  }
  return { orderedQty: read('ORD'), newTotal: read('TOT'), excess: read('EXC') }
}
