import { describe, expect, it } from 'vitest'
import { formatDateTime, formatDate, formatRelativeDateTime } from '~/core/format'

describe('formatRelativeDateTime', () => {
  const baseDate = new Date('2026-10-05T14:16:00')

  it('mengembalikan "Belum pernah diunduh" untuk nilai null, undefined, atau tidak valid', () => {
    expect(formatRelativeDateTime(null, baseDate)).toBe('Belum pernah diunduh')
    expect(formatRelativeDateTime(undefined, baseDate)).toBe('Belum pernah diunduh')
    expect(formatRelativeDateTime('invalid-date', baseDate)).toBe('Belum pernah diunduh')
  })

  it('mengembalikan "Baru saja" untuk waktu kurang dari 1 menit', () => {
    const justNow = new Date('2026-10-05T14:15:30')
    expect(formatRelativeDateTime(justNow, baseDate)).toBe('Baru saja')
  })

  it('mengembalikan "X menit yang lalu" untuk rentang di bawah 1 jam', () => {
    const tenMinAgo = new Date('2026-10-05T14:06:00')
    expect(formatRelativeDateTime(tenMinAgo, baseDate)).toBe('10 menit yang lalu')

    const userCase = new Date('2026-10-05T13:57:00')
    expect(formatRelativeDateTime(userCase, baseDate)).toBe('19 menit yang lalu')
  })

  it('mengembalikan "Hari ini, pukul HH.mm (X jam yang lalu)" untuk hari ini di atas 1 jam', () => {
    const twoHoursAgo = new Date('2026-10-05T12:00:00')
    expect(formatRelativeDateTime(twoHoursAgo, baseDate)).toBe(
      'Hari ini, pukul 12.00 (2 jam yang lalu)',
    )
  })

  it('mengembalikan "Kemarin, pukul HH.mm" untuk tanggal kemarin', () => {
    const yesterday = new Date('2026-10-04T15:30:00')
    expect(formatRelativeDateTime(yesterday, baseDate)).toBe('Kemarin, pukul 15.30')
  })

  it('mengembalikan tanggal kalender lengkap untuk waktu lebih dari 1 hari lalu', () => {
    const older = new Date('2026-10-02T10:00:00')
    expect(formatRelativeDateTime(older, baseDate)).toBe('2 Okt 2026, pukul 10.00')
  })
})
