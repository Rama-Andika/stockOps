import { useEffect } from 'react'
import { AlertTriangle, Check, X } from 'lucide-react'

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

const TONE_ICON = {
  success: Check,
  warn: AlertTriangle,
  danger: X,
} as const

/** Prominent scan feedback banner that dismisses automatically. */
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

  const Icon = TONE_ICON[feedback.tone]

  return (
    <div
      key={feedback.key}
      role="status"
      aria-live="polite"
      className={`pointer-events-none fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 px-4 py-3 text-lg font-bold shadow-lg ${TONE_STYLES[feedback.tone]}`}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
      <span>{feedback.text}</span>
    </div>
  )
}
