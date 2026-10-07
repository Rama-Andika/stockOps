import { describe, expect, it } from 'vitest'
import {
  CSV_COLUMNS,
  CSV_SEPARATOR,
  buildDiagnosticsCsv,
  buildDiagnosticsSummary,
  csvCell,
  diagnosticsFileName,
} from '~/client/diagnostics/csv'
import type { DiagnosticsExport } from '~/client/diagnostics/read'
import { SESSION_STATUS } from '~/shared/constants'

/**
 * Berkas inilah yang beredar ke luar perangkat: operator mengirimkannya ke tim IT, dan tim IT
 * membukanya di Excel. Satu sel yang salah di-escape merusak seluruh berkas, dan urutan baris yang
 * terbalik menyesatkan pembacanya tanpa memberi tanda apa pun bahwa ada yang salah.
 */
const PAYLOAD: DiagnosticsExport = {
  snapshot: {
    deviceId: 'pdt-wh-001-abcdef',
    appVersion: '1.0.0',
    appBuildTime: '2026-10-07T06:00:00.000Z',
    online: true,
    statusCounts: {
      [SESSION_STATUS.RUNNING]: 1,
      [SESSION_STATUS.PENDING]: 2,
      [SESSION_STATUS.SYNCING]: 0,
      [SESSION_STATUS.SYNCED]: 3,
      [SESSION_STATUS.FAILED]: 1,
      [SESSION_STATUS.REJECTED]: 0,
    },
    lastPushAt: '2026-10-07T07:00:00.000Z',
    lastPullAt: '2026-10-07T06:30:00.000Z',
    purchasesStale: true,
    totalEntries: 3,
    problemEntries: 2,
    logMax: 2000,
  },
  sessions: [
    {
      sessionId: 'S1',
      status: SESSION_STATUS.FAILED,
      purchaseNumber: 'PO10250001',
      // Tanda titik koma di nama vendor: justru pemisah CSV-nya sendiri.
      vendorName: 'CV Berkah; Jaya',
      updatedAt: '2026-10-07T07:05:00.000Z',
      number: null,
      failureCode: 'SERVER_ERROR',
      lastError: 'Koneksi terputus',
      lines: 4,
      overReceive: false,
      excessTotal: 0,
      userLoginId: 'op_budi',
    },
  ],
  // Tertua dulu — sebagaimana `collectDiagnosticsExport` menyerahkannya.
  entries: [
    {
      id: 1,
      at: '2026-10-07T07:00:00.000Z',
      level: 'info',
      message: 'Kirim selesai: 2 berhasil, 0 gagal dari 2 dokumen.',
      category: 'sync',
      event: 'PUSH_RUN',
    },
    {
      id: 2,
      at: '2026-10-07T07:01:00.000Z',
      level: 'warn',
      message: 'Gagal; dengan "kutip" di dalamnya',
      category: 'sync',
      event: 'PUSH_SESSION_FAILED',
      sessionId: 'S1',
    },
    {
      id: 3,
      at: '2026-10-07T07:02:00.000Z',
      level: 'error',
      message: '=RUMUS()',
      category: 'app',
      event: 'UNHANDLED_ERROR',
      detail: { stack: 'Error: x' },
    },
  ],
}

function lines(csv: string): string[] {
  return csv.replace(/^\uFEFF/, '').split('\r\n').filter((line) => line.length > 0)
}

describe('buildDiagnosticsCsv', () => {
  it('diawali BOM UTF-8, berakhiran CRLF, dan barisnya dipisah titik koma', () => {
    const csv = buildDiagnosticsCsv(PAYLOAD, new Date('2026-10-07T08:00:00.000Z'))

    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv.endsWith('\r\n')).toBe(true)
    expect(lines(csv)[0]).toBe(CSV_COLUMNS.join(CSV_SEPARATOR))
  })

  it('menulis META dulu, lalu SESSION, lalu LOG', () => {
    const rows = lines(buildDiagnosticsCsv(PAYLOAD, new Date('2026-10-07T08:00:00.000Z'))).slice(1)
    const types = rows.map((row) => row.split(CSV_SEPARATOR)[0])

    expect(types.indexOf('SESSION')).toBeGreaterThan(types.lastIndexOf('META'))
    expect(types.indexOf('LOG')).toBeGreaterThan(types.lastIndexOf('SESSION'))
  })

  it('menulis baris LOG tertua dulu — kebalikan dari layar', () => {
    const rows = lines(buildDiagnosticsCsv(PAYLOAD, new Date('2026-10-07T08:00:00.000Z')))
    const logRows = rows.filter((row) => row.startsWith('LOG'))

    expect(logRows[0]).toContain('PUSH_RUN')
    expect(logRows[logRows.length - 1]).toContain('UNHANDLED_ERROR')
  })

  it('membawa Device ID lengkap di baris META, bukan hanya di nama berkas', () => {
    const csv = buildDiagnosticsCsv(PAYLOAD, new Date('2026-10-07T08:00:00.000Z'))

    expect(csv).toContain('pdt-wh-001-abcdef')
  })

  it('menyertakan jumlah sesi per status sebagai baris META', () => {
    const csv = buildDiagnosticsCsv(PAYLOAD, new Date('2026-10-07T08:00:00.000Z'))

    expect(csv).toContain('sessions.PENDING')
    expect(csv).toContain('sessions.REJECTED')
  })

  it('membungkus sel yang memuat pemisah atau tanda kutip', () => {
    const csv = buildDiagnosticsCsv(PAYLOAD, new Date('2026-10-07T08:00:00.000Z'))

    expect(csv).toContain('"PO10250001 / CV Berkah; Jaya"')
    expect(csv).toContain('"Gagal; dengan ""kutip"" di dalamnya"')
  })

  it('melumpuhkan sel yang akan dieksekusi Excel sebagai rumus', () => {
    const csv = buildDiagnosticsCsv(PAYLOAD, new Date('2026-10-07T08:00:00.000Z'))

    expect(csv).toContain("'=RUMUS()")
  })
})

describe('csvCell', () => {
  it('membiarkan teks biasa apa adanya dan mengosongkan nilai kosong', () => {
    expect(csvCell('PUSH_RUN')).toBe('PUSH_RUN')
    expect(csvCell(12)).toBe('12')
    expect(csvCell(false)).toBe('false')
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })

  it('membungkus pemisah, tanda kutip, dan baris baru', () => {
    expect(csvCell('a;b')).toBe('"a;b"')
    expect(csvCell('a"b')).toBe('"a""b"')
    expect(csvCell('a\nb')).toBe('"a\nb"')
  })

  it('melindungi = + @ tapi SENGAJA tidak melindungi tanda hubung', () => {
    expect(csvCell('=1+1')).toBe("'=1+1")
    expect(csvCell('+62')).toBe("'+62")
    expect(csvCell('@here')).toBe("'@here")
    // Pesan berbahasa Indonesia sah dimulai dengan tanda hubung; mengawalinya dengan apostrof
    // justru merusak teks yang bisa dibaca.
    expect(csvCell('- tidak ada')).toBe('- tidak ada')
  })
})

describe('diagnosticsFileName', () => {
  it('memakai 8 karakter Device ID yang sudah dibersihkan dan cap waktu lokal', () => {
    // Sengaja memakai konstruktor waktu LOKAL: nama berkas memang mengikuti jam perangkat.
    const name = diagnosticsFileName('pdt-wh-001-abcdef', new Date(2026, 9, 7, 14, 5))

    expect(name).toBe('stockops-diag-pdtwh001-20261007-1405.csv')
  })

  it('tetap menghasilkan nama yang sah saat Device ID belum ada', () => {
    const name = diagnosticsFileName(null, new Date(2026, 9, 7, 9, 0))

    expect(name).toBe('stockops-diag-unknown-20261007-0900.csv')
  })
})

describe('buildDiagnosticsSummary', () => {
  it('memuat potret perangkat dan masalah terbaru lebih dulu', () => {
    const summary = buildDiagnosticsSummary(PAYLOAD)

    expect(summary).toContain('Device: pdt-wh-001-abcdef')
    expect(summary).toContain('Daftar PO perlu disegarkan: ya')
    expect(summary.indexOf('UNHANDLED_ERROR')).toBeLessThan(summary.indexOf('PUSH_SESSION_FAILED'))
  })

  it('tidak memuat entri info, dan mengatakan apa adanya saat tidak ada masalah', () => {
    const summary = buildDiagnosticsSummary(PAYLOAD)
    expect(summary).not.toContain('PUSH_RUN')

    const quiet = buildDiagnosticsSummary({
      ...PAYLOAD,
      entries: PAYLOAD.entries.filter((entry) => entry.level === 'info'),
    })
    expect(quiet).toContain('- tidak ada')
  })
})
