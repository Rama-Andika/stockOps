import { useEffect } from 'react'

export type ScanFeedbackTone = 'success' | 'warn' | 'danger'

export interface ScanFeedbackData {
  tone: ScanFeedbackTone
  text: string
  key: number
}

const TONE_STYLES: Record<ScanFeedbackTone, string> = {
  success: 'bg-emerald-600 text-white',
  warn: 'bg-amber-500 text-slate-950',
  danger: 'bg-red-600 text-white',
}

const TONE_ICON: Record<ScanFeedbackTone, string> = {
  success: '✓',
  warn: '!',
  danger: '✕',
}

/** Banner umpan balik scan yang mudah terlihat dan otomatis hilang. */
export function ScanFeedback({
  feedback,
  onDismiss,
  durationMs = 1800,
}: {
  feedback: ScanFeedbackData | null
  onDismiss: () => void
  durationMs?: number
}) {
  useEffect(() => {
    if (!feedback) return
    const timer = window.setTimeout(onDismiss, durationMs)
    return () => window.clearTimeout(timer)
  }, [feedback, durationMs, onDismiss])

  if (!feedback) return null

  return (
    <div
      key={feedback.key}
      role="status"
      aria-live="polite"
      className={`pointer-events-none fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 px-4 py-3 text-lg font-bold shadow-lg ${TONE_STYLES[feedback.tone]}`}
    >
      <span aria-hidden="true">{TONE_ICON[feedback.tone]}</span>
      <span>{feedback.text}</span>
    </div>
  )
}
