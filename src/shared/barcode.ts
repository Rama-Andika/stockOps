/**
 * Item identification via barcode/code (FR-4.3, B-4, BR-14).
 *
 * Barcode matching is performed against barcode, barcode_2, and barcode_3.
 * If a barcode is damaged, the operator may search by `code` (B-4).
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

/** All items matching the scanned barcode (can be more than one). */
export function findItemsByBarcode(
  items: readonly ScannableItem[],
  scanned: string,
): ScannableItem[] {
  const needle = normalize(scanned)
  if (needle.length === 0) return []
  return items.filter((item) => barcodeFields(item).includes(needle))
}

/** A single matching item (null if none). */
export function findItemByBarcode(
  items: readonly ScannableItem[],
  scanned: string,
): ScannableItem | null {
  return findItemsByBarcode(items, scanned)[0] ?? null
}

/** Manual search by item code (damaged barcode). */
export function findItemByCode(
  items: readonly ScannableItem[],
  code: string,
): ScannableItem | null {
  const needle = normalize(code)
  if (needle.length === 0) return null
  return items.find((item) => normalize(item.code) === needle) ?? null
}
