/**
 * Identifikasi barang via barcode/kode (FR-4.3, B-4, BR-14).
 *
 * Pencocokan barcode dilakukan terhadap barcode, barcode_2, dan barcode_3.
 * Bila barcode rusak, operator boleh mencari berdasarkan `code` (B-4).
 */

export interface ScannableItem {
  itemMasterId: string
  code: string | null
  barcode: string | null
  barcode_2: string | null
  barcode_3: string | null
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function barcodeFields(item: ScannableItem): string[] {
  return [item.barcode, item.barcode_2, item.barcode_3]
    .map(normalize)
    .filter((value) => value.length > 0)
}

/** Semua barang yang cocok dengan barcode hasil scan (bisa lebih dari satu). */
export function findItemsByBarcode(
  items: readonly ScannableItem[],
  scanned: string,
): ScannableItem[] {
  const needle = normalize(scanned)
  if (needle.length === 0) return []
  return items.filter((item) => barcodeFields(item).includes(needle))
}

/** Satu barang yang cocok (null bila tidak ada). */
export function findItemByBarcode(
  items: readonly ScannableItem[],
  scanned: string,
): ScannableItem | null {
  return findItemsByBarcode(items, scanned)[0] ?? null
}

/** Pencarian manual berdasarkan kode barang (barcode rusak). */
export function findItemByCode(
  items: readonly ScannableItem[],
  code: string,
): ScannableItem | null {
  const needle = normalize(code)
  if (needle.length === 0) return null
  return items.find((item) => normalize(item.code) === needle) ?? null
}
