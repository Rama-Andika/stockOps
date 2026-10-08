import { describe, expect, it } from 'vitest'
import { SESSION_STATUS } from '~/core/contracts/constants'
import {
  SELF_OWNER_LABEL,
  UNKNOWN_OWNER_LABEL,
  canEditSession,
  findRunningSessionForPurchase,
  isOwnedBy,
  ownerLabel,
  ownerName,
  splitByOwner,
} from '~/features/receiving/logic/session-owner'

const budi = { userId: 'U1', userFullName: 'Budi Santoso', userLoginId: 'op_budi' }
const tanpaNama = { userId: 'U9', userFullName: null, userLoginId: null }

describe('isOwnedBy', () => {
  it('mencocokkan userId', () => {
    expect(isOwnedBy(budi, 'U1')).toBe(true)
    expect(isOwnedBy(budi, 'U9')).toBe(false)
  })

  it('tanpa user login, tidak ada sesi yang dianggap milik siapa pun', () => {
    // Memaku arah default. Kalau dibalik menjadi "semuanya milik saya", jendela singkat sebelum
    // app/shell mengarahkan ke /login akan membuka seluruh sesi orang lain untuk diubah.
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

describe('findRunningSessionForPurchase', () => {
  // Berbentuk seperti keluaran `runningSessions()`: hanya RUNNING, terbaru di atas.
  const sesiSaya = { sessionId: 'S1', purchaseId: 'P1', userId: 'U1' }
  const sesiSayaLebihLama = { sessionId: 'S0', purchaseId: 'P1', userId: 'U1' }
  const sesiRekan = { sessionId: 'S2', purchaseId: 'P1', userId: 'U9' }
  const sesiSayaPoLain = { sessionId: 'S3', purchaseId: 'P2', userId: 'U1' }

  it('menemukan sesi berjalan milik sendiri untuk PO itu', () => {
    expect(findRunningSessionForPurchase([sesiSaya], 'P1', 'U1')?.sessionId).toBe('S1')
  })

  it('sesi rekan untuk PO yang sama BUKAN duplikat', () => {
    // Keputusan produk, bukan kelalaian: satu PO boleh diterima dua operator di perangkat yang
    // sama. Kalau arah ini dibalik, operator kedua kehilangan satu-satunya jalan untuk memulai
    // sesinya sendiri — dan akan terjebak di gerbang kepemilikan sesi rekannya.
    expect(findRunningSessionForPurchase([sesiRekan], 'P1', 'U1')).toBeUndefined()
  })

  it('sesi sendiri untuk PO lain bukan duplikat', () => {
    expect(findRunningSessionForPurchase([sesiSayaPoLain], 'P1', 'U1')).toBeUndefined()
  })

  it('melewati sesi rekan dan tetap menemukan sesi sendiri di belakangnya', () => {
    expect(findRunningSessionForPurchase([sesiRekan, sesiSaya], 'P1', 'U1')?.sessionId).toBe('S1')
  })

  it('bila ada beberapa sesi sendiri, yang pertama pada urutan masukan menang', () => {
    // `runningSessions()` mengurutkan terbaru di atas, jadi "pertama" berarti "terbaru". Data yang
    // ditulis sebelum fitur ini bisa punya lebih dari satu sesi berjalan untuk satu PO, dan itu
    // sengaja tidak dibersihkan — jadi arah pemilihannya dipaku di sini.
    expect(
      findRunningSessionForPurchase([sesiSaya, sesiSayaLebihLama], 'P1', 'U1')?.sessionId,
    ).toBe('S1')
  })

  it('tanpa user login, tidak ada yang dianggap duplikat', () => {
    expect(findRunningSessionForPurchase([sesiSaya], 'P1', null)).toBeUndefined()
    expect(findRunningSessionForPurchase([sesiSaya], 'P1', undefined)).toBeUndefined()
  })

  it('daftar kosong aman', () => {
    const kosong: (typeof sesiSaya)[] = []
    expect(findRunningSessionForPurchase(kosong, 'P1', 'U1')).toBeUndefined()
  })
})
