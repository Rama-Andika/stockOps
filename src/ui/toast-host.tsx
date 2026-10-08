import { useSyncExternalStore } from 'react'
import { dismissToast, getToasts, subscribeToasts, type ToastTone } from '~/platform/toast'

const TONE_STYLES: Record<ToastTone, string> = {
  success: 'bg-ok-solid text-white',
  danger: 'bg-danger text-white',
  info: 'bg-info-solid text-white',
  warn: 'bg-warn-solid text-on-warn',
}

/** Renders the toast stack in the top-right corner. Mounted once in AppShell. */
export function ToastHost() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts)
  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed right-3 top-3 z-60 flex flex-col gap-2">
      {toasts.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => dismissToast(item.id)}
          className={`pointer-events-auto max-w-xs rounded-lg px-4 py-2 text-left text-sm font-semibold shadow-lg ${TONE_STYLES[item.tone]}`}
        >
          {item.text}
        </button>
      ))}
    </div>
  )
}
