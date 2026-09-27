/** Sistem toast minimal (kanan-atas), dipakai lintas halaman. */

export type ToastTone = 'success' | 'danger' | 'info' | 'warn'

export interface ToastItem {
  id: number
  tone: ToastTone
  text: string
}

let toasts: ToastItem[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getToasts(): ToastItem[] {
  return toasts
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((item) => item.id !== id)
  emit()
}

/** Tampilkan toast selama ±3 detik. Aman dipanggil saat prerender (tanpa window). */
export function toast(tone: ToastTone, text: string): void {
  const item: ToastItem = { id: nextId, tone, text }
  nextId += 1
  toasts = [...toasts, item]
  emit()
  if (typeof window !== 'undefined') {
    window.setTimeout(() => dismissToast(item.id), 3000)
  }
}
