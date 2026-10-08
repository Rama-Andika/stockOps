// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeToggle } from '~/app/theme-toggle'
import { applyThemePreference } from '~/platform/theme'
import { loadPreferences } from '~/platform/preferences'
import { setScanFocusHandler } from '~/platform/scan-focus'

/**
 * `src/platform/theme.ts` is a module singleton that reads localStorage once at import time, so
 * every test resets BOTH sides of it: storage, and the attribute on <html>. `applyThemePreference`
 * is what pulls the module's own value back in step after storage is cleared.
 */
beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  applyThemePreference()
})

afterEach(() => {
  setScanFocusHandler(null)
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  applyThemePreference()
})

describe('ThemeToggle', () => {
  it('default gelap: menawarkan tema terang dan tidak memasang atribut apa pun', () => {
    render(<ThemeToggle />)

    expect(screen.getByRole('button', { name: 'Ganti ke tema terang' })).toBeInTheDocument()
    // Dark is the ABSENCE of the attribute, not data-theme="dark". That is what keeps the dark
    // theme byte-for-byte what it was before the light theme existed.
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('satu klik menyalakan tema terang di <html> dan menyimpannya', () => {
    render(<ThemeToggle />)

    fireEvent.click(screen.getByRole('button', { name: 'Ganti ke tema terang' }))

    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(loadPreferences().theme).toBe('light')
    // The label flips too: the icon shows the DESTINATION, so a light theme offers the dark one.
    expect(screen.getByRole('button', { name: 'Ganti ke tema gelap' })).toBeInTheDocument()
  })

  it('klik kedua kembali ke gelap dan mencabut atributnya', () => {
    render(<ThemeToggle />)

    fireEvent.click(screen.getByRole('button', { name: 'Ganti ke tema terang' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ganti ke tema gelap' }))

    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(loadPreferences().theme).toBe('dark')
  })

  /**
   * The reason this button is allowed to live in the app bar at all. It renders on every screen,
   * the scan cockpit included, so after it is pressed the focus must go back to the barcode field
   * — otherwise the scanner's closing Enter presses this button again instead of submitting a
   * scan, and the operator sees the theme flip on every scan. Same rule as "Nanti" in
   * UpdateBanner.
   */
  it('mengembalikan fokus ke field barcode setelah ditekan', () => {
    const handler = vi.fn()
    setScanFocusHandler(handler)
    render(<ThemeToggle />)

    fireEvent.click(screen.getByRole('button', { name: 'Ganti ke tema terang' }))

    expect(handler).toHaveBeenCalledTimes(1)
  })
})
