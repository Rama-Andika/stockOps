import { describe, expect, it } from 'vitest'
import { SESSION_STATUS } from '~/shared/constants'
import {
  SELF_OWNER_LABEL,
  UNKNOWN_OWNER_LABEL,
  canEditSession,
  isOwnedBy,
  ownerLabel,
  ownerName,
  splitByOwner,
} from '~/shared/session-owner'

const budi = { userId: 'U1', userFullName: 'Budi Santoso', userLoginId: 'op_budi' }
const tanpaNama = { userId: 'U9', userFullName: null, userLoginId: null }

describe('isOwnedBy', () => {
  it('mencocokkan userId', () => {
    expect(isOwnedBy(budi, 'U1')).toBe(true)
    expect(isOwnedBy(budi, 'U9')).toBe(false)
  })

  it('tanpa user login, tidak ada sesi yang dianggap milik siapa pun', () => {
    // Memaku arah default. Kalau dibalik menjadi "semuanya milik saya", jendela singkat sebelum
    // app-shell mengarahkan ke /login akan membuka seluruh sesi orang lain untuk diubah.
    expect(isOwnedBy(budi, null)).toBe(false)
    expect(isOwnedBy(budi, undefined)).toBe(false)
    expect(isOwnedBy(budi, '')).toBe(false)
  })
})

describe('ownerName', () => {
  it('memakai nama lengkap bila ada', () => {
    expect(ownerName(budi)).toBe('Budi Santoso')
  })

  it('jatuh ke loginId bila nama lengkap kosong atau hanya spasi', () => {
    expect(ownerName({ userId: 'U1', userFullName: null, userLoginId: 'op_budi' })).toBe('op_budi')
    expect(ownerName({ userId: 'U1', userFullName: '   ', userLoginId: 'op_budi' })).toBe('op_budi')
  })

  it('jatuh ke label generik bila keduanya tidak ada — bukan userId mentah', () => {
    // userId adalah bigint; menampilkannya ke operator sama saja dengan tidak menampilkan apa pun.
    expect(ownerName(tanpaNama)).toBe(UNKNOWN_OWNER_LABEL)
    expect(ownerName({ userId: 'U9' })).toBe(UNKNOWN_OWNER_LABEL)
    expect(ownerName(tanpaNama)).not.toContain('U9')
  })
})

describe('ownerLabel', () => {
  it('menyebut "Saya" untuk sesi sendiri dan nama untuk sesi orang lain', () => {
    expect(ownerLabel(budi, 'U1')).toBe(SELF_OWNER_LABEL)
    expect(ownerLabel(budi, 'U9')).toBe('Budi Santoso')
  })
})

describe('canEditSession', () => {
  it('hanya RUNNING + milik sendiri yang boleh diubah', () => {
    expect(canEditSession({ ...budi, status: SESSION_STATUS.RUNNING }, 'U1')).toBe(true)
  })

  it('RUNNING milik orang lain tidak boleh diubah', () => {
    expect(canEditSession({ ...budi, status: SESSION_STATUS.RUNNING }, 'U9')).toBe(false)
  })

  it('sesi sendiri yang sudah difinalisasi tetap tidak boleh diubah', () => {
    // Separuh aturan yang sudah ada sebelum fitur ini (dulu `editable` di kokpit). Dites supaya
    // penambahan syarat kepemilikan tidak diam-diam melonggarkan syarat status.
    for (const status of [
      SESSION_STATUS.PENDING,
      SESSION_STATUS.SYNCING,
      SESSION_STATUS.SYNCED,
      SESSION_STATUS.FAILED,
      SESSION_STATUS.REJECTED,
    ]) {
      expect(canEditSession({ ...budi, status }, 'U1')).toBe(false)
    }
  })

  it('tanpa user login tidak ada yang boleh diubah', () => {
    expect(canEditSession({ ...budi, status: SESSION_STATUS.RUNNING }, null)).toBe(false)
  })
})

describe('splitByOwner', () => {
  it('memisahkan dua kelompok dan mempertahankan urutan masukan', () => {
    const rows = [
      { sessionId: 'S1', userId: 'U1' },
      { sessionId: 'S2', userId: 'U9' },
      { sessionId: 'S3', userId: 'U1' },
      { sessionId: 'S4', userId: 'U2' },
    ]
    const { mine, others } = splitByOwner(rows, 'U1')
    // Urutan masukan adalah urutan yang dipakai layar (listSessions: terbaru di atas).
    expect(mine.map((row) => row.sessionId)).toEqual(['S1', 'S3'])
    expect(others.map((row) => row.sessionId)).toEqual(['S2', 'S4'])
  })

  it('tanpa user login, semuanya masuk kelompok "others"', () => {
    const { mine, others } = splitByOwner([{ userId: 'U1' }, { userId: 'U9' }], null)
    expect(mine).toHaveLength(0)
    expect(others).toHaveLength(2)
  })
})
