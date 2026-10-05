/**
 * Browsers only expose WebCrypto (crypto.subtle) and service workers in a secure
 * context: https:// or localhost. A PDT opening http://<LAN-IP> is NOT one.
 */

/** True when the page runs in a non-secure context (plain http:// on a non-localhost address). */
export function isInsecureContext(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext === false
}

/** True when PBKDF2 (crypto.subtle) is available for offline credentials. */
export function hasWebCrypto(): boolean {
  return typeof globalThis.crypto?.subtle !== 'undefined'
}

export const INSECURE_CONTEXT_MESSAGE =
  'Koneksi tidak aman: buka aplikasi lewat alamat https:// (atau localhost). Login tidak bisa diproses lewat http:// biasa.'
