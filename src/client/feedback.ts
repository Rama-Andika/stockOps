import { loadPreferences } from './preferences'

export type FeedbackTone = 'success' | 'warn' | 'over' | 'danger'

interface ToneSpec {
  frequency: number
  durationMs: number
  /** How many times the tone is played. 1 means a single beep. */
  repeat: number
  /** Start-to-start distance between repeats, in ms. Ignored when `repeat` is 1. */
  gapMs: number
}

/**
 * Scan feedback on a PDT's speaker. ONE table for every tone, so a new one cannot quietly land
 * below the audible band.
 *
 * TWO rules here are load-bearing and both were paid for by a bug in the field:
 *
 *  1. EVERY tone sits at or above 950 Hz. The first version used 220 Hz for failures and on a real
 *     device it was inaudible: a small speaker rolls off steeply below ~400 Hz. Success (1000 Hz)
 *     was heard, so the bug read as "no sound on failure" rather than as a frequency problem — and
 *     it survived a long time because of that. Do NOT lower these numbers to make the beeps
 *     gentler; a gentler beep here is a silent one.
 *  2. The wave is `square`, not `sine`. A sine has no harmonics above its own pitch, and the
 *     harmonics are what carry over a forklift.
 *
 * Length, not pitch, is what separates the three signals: one short blip, two mid beeps, one long
 * buzz. Length survives a noisy dock far better than pitch does.
 */
const FAIL: ToneSpec = { frequency: 1800, durationMs: 400, repeat: 1, gapMs: 0 }

const TONES: Record<FeedbackTone, ToneSpec> = {
  // The sound the operator hears hundreds of times a shift — as short as it can be.
  success: { frequency: 1200, durationMs: 70, repeat: 1, gapMs: 0 },
  /**
   * Over-receive keeps a signal of its own, and that is deliberate: the line IS saved, it only
   * needs approval. Sounding it as a failure would teach operators to scan the same box a second
   * time, which is exactly how duplicates are born. To collapse it into the failure sound one day,
   * this single entry is all that changes.
   */
  over: { frequency: 950, durationMs: 90, repeat: 2, gapMs: 150 },
  /**
   * `warn` and `danger` are the SAME sound on purpose: the operator asked for one failure signal,
   * because two different short failure beeps could not be told apart in a noisy dock. The two
   * names stay because the CALL SITES mean different things — `warn` is "nothing was recorded",
   * `danger` is "something went wrong" — and the card on screen is what carries that difference.
   */
  warn: FAIL,
  danger: FAIL,
}

const FAIL_VIBRATION: number[] = [120, 60, 120]

/** Same split as `TONES`, for the same reasons. */
const VIBRATIONS: Record<FeedbackTone, number | number[]> = {
  success: 40,
  over: [60, 80, 60],
  warn: FAIL_VIBRATION,
  danger: FAIL_VIBRATION,
}

/**
 * Peak gain of the envelope. A square wave is perceptually louder than a sine at the same gain,
 * so this is not as hot as it looks; it is what it takes to be heard on a hand-held speaker.
 */
const PEAK_GAIN = 0.25

let audioCtx: AudioContext | null = null

/**
 * The one AudioContext for the whole app. It deliberately does NOT resume here — see `playBeep`:
 * resuming and scheduling in the same breath is what loses the first tone.
 */
function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null

  try {
    if (!audioCtx || audioCtx.state === 'closed') audioCtx = new Ctor()
    return audioCtx
  } catch {
    return null
  }
}

function startTone(ctx: AudioContext, frequency: number, durationMs: number): void {
  try {
    const seconds = durationMs / 1000
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = 'square'
    oscillator.frequency.value = frequency

    const now = ctx.currentTime
    // Attack, HOLD, release — three stages, not two. The hold is what the long failure tone needs:
    // a single exponential decay across 400 ms is already near silence for most of its length,
    // which is the opposite of what a "no-read" buzz has to be. `Math.max` keeps the hold from
    // landing before the attack has finished on the short tones.
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, now + 0.01)
    gain.gain.setValueAtTime(PEAK_GAIN, Math.max(now + 0.011, now + seconds - 0.03))
    gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds)

    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.start(now)
    oscillator.stop(now + seconds + 0.02)
  } catch {
    // Audio not available / blocked by browser — not an application error.
  }
}

function playBeep(frequency: number, durationMs: number): void {
  const ctx = getAudioContext()
  if (!ctx) return

  // A context created before any user gesture starts `suspended`, and while it is suspended
  // `currentTime` DOES NOT ADVANCE. Scheduling the envelope first and resuming afterwards
  // therefore puts every event in the past: the ramps jump straight to their final values and the
  // oscillator stops immediately, so the tone is lost. That is why the tone is scheduled INSIDE
  // the resume callback. It costs a few milliseconds on the first beep after a page load and
  // nothing afterwards.
  //
  // No priming listener is needed anywhere: a barcode arrives as a `keydown` (the scanner's
  // closing Enter), which the browser already counts as a user gesture, so `resume()` succeeds.
  if (ctx.state === 'suspended') {
    void ctx
      .resume()
      .then(() => startTone(ctx, frequency, durationMs))
      .catch(() => undefined)
    return
  }

  startTone(ctx, frequency, durationMs)
}

/** Play scan feedback according to device preferences. */
export function playFeedback(tone: FeedbackTone): void {
  const preferences = loadPreferences()

  if (preferences.feedbackBeep) {
    const { frequency, durationMs, repeat, gapMs } = TONES[tone]
    playBeep(frequency, durationMs)
    // Repeats are scheduled from NOW, not chained off the previous tone: one AudioContext plays
    // them all, and nothing has to wait for anything to finish.
    if (typeof window !== 'undefined') {
      for (let index = 1; index < repeat; index += 1) {
        window.setTimeout(() => playBeep(frequency, durationMs), gapMs * index)
      }
    }
  }

  if (preferences.feedbackVibrate && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(VIBRATIONS[tone])
    } catch {
      // Vibration API not supported or blocked by device.
    }
  }
}
