import { loadPreferences } from './preferences'

export type FeedbackTone = 'success' | 'warn' | 'danger'

let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null

  try {
    if (!audioCtx || audioCtx.state === 'closed') audioCtx = new Ctor()
    if (audioCtx.state === 'suspended') void audioCtx.resume().catch(() => undefined)
    return audioCtx
  } catch {
    return null
  }
}

function playBeep(frequency: number, durationMs: number): void {
  const ctx = getAudioContext()
  if (!ctx) return

  try {
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000)
    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.start()
    oscillator.stop(ctx.currentTime + durationMs / 1000 + 0.02)
  } catch {
    // Audio tidak tersedia / ditolak browser — bukan error aplikasi.
  }
}

/** Mainkan umpan balik scan sesuai preferensi perangkat. */
export function playFeedback(tone: FeedbackTone): void {
  const preferences = loadPreferences()

  if (preferences.feedbackBeep) {
    if (tone === 'success') playBeep(1000, 80)
    else if (tone === 'danger') playBeep(220, 220)
    else playBeep(520, 100)
  }

  if (preferences.feedbackVibrate && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      if (tone === 'success') navigator.vibrate(40)
      else if (tone === 'danger') navigator.vibrate([120, 60, 120])
      else navigator.vibrate(80)
    } catch {
      // Vibration API tidak didukung atau diblokir perangkat.
    }
  }
}
