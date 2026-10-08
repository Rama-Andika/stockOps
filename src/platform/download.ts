/**
 * Getting text off the device.
 *
 * Both functions return a boolean instead of throwing, because the caller's job is to pick the
 * next fallback, not to show a stack trace. This matters more than it looks: a number of Android
 * WebViews without a `DownloadListener` swallow an `<a download>` + Blob URL without a word, and
 * on those devices the operator taps "Ekspor CSV" and NOTHING happens — a failure no log can
 * explain, because the log is what failed to come out.
 */

export function downloadTextFile(
  fileName: string,
  text: string,
  mimeType = 'text/csv;charset=utf-8',
): boolean {
  if (typeof document === 'undefined') return false
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false
  let url: string | null = null
  try {
    url = URL.createObjectURL(new Blob([text], { type: mimeType }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.rel = 'noopener'
    anchor.style.display = 'none'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    return true
  } catch {
    return false
  } finally {
    // Revoked LATE, never right after the click: some WebViews start reading the blob only after
    // the click returns, and revoking immediately cancels the download that just started.
    if (url !== null) {
      const created = url
      window.setTimeout(() => URL.revokeObjectURL(created), 10_000)
    }
  }
}

export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Clipboard access needs a secure context and a user gesture; both can be missing on a PDT.
    return false
  }
}
