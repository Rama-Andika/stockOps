/**
 * Matching a scanned string to an item in the master data.
 *
 * A PDT scanner types into the barcode field like a keyboard, so what arrives here is plain
 * text: it may be a real barcode or an item code typed by hand. Matching therefore covers all
 * three barcode columns (barcode, barcode_2, barcode_3) AND the item `code` column, because a
 * scuffed or torn label is routine in a warehouse and the operator must still be able to
 * receive the goods.
 *
 * Finding the item is only half the job. The caller still has to check that the item is part
 * of the PO being received — an item outside the PO is refused with a warning rather than
 * added. That check lives in the scanning service, not here.
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

/**
 * All items matching the scanned barcode. More than one hit is possible: the admin master
 * data does not enforce unique barcodes, so the caller decides how to handle ambiguity.
 */
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

/**
 * Exact match on the item code, the way out when a label cannot be scanned at all.
 * Exact and not prefix on purpose — a partial code must never silently resolve to a
 * neighbouring item.
 */
export function findItemByCode(
  items: readonly ScannableItem[],
  code: string,
): ScannableItem | null {
  const needle = normalize(code)
  if (needle.length === 0) return null
  return items.find((item) => normalize(item.code) === needle) ?? null
}
