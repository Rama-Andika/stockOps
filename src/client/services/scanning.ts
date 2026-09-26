import type { LocalItem, LocalPurchaseItem, LocalSessionItem } from '../db/local-db'
import type { LocalRepository } from '../db/local-repo'
import { resolveConvQty } from '~/shared/uom'

export type ScanStatus = 'OK' | 'ITEM_NOT_FOUND' | 'NOT_IN_PO'

export interface ScanResolution {
  status: ScanStatus
  message: string
  item?: LocalItem
  purchaseItem?: LocalPurchaseItem
  convQty: number
  convFound: boolean
}

/**
 * FR-4.3 / BR-14: mengubah hasil scan menjadi item + baris PO + faktor konversi.
 * Barang yang bukan bagian dari PO ditolak dengan pesan (bukan exception).
 */
export async function resolveScan(
  repo: LocalRepository,
  purchaseId: string,
  scannedCode: string,
): Promise<ScanResolution> {
  const item = await repo.getItemByBarcodeOrCode(scannedCode)
  if (!item) {
    return {
      status: 'ITEM_NOT_FOUND',
      message: `Barcode/kode "${scannedCode}" tidak dikenali.`,
      convQty: 1,
      convFound: false,
    }
  }

  const purchase = await repo.getPurchase(purchaseId)
  const purchaseItems = await repo.getPurchaseItems(purchaseId)
  const purchaseItem = purchaseItems.find((row) => row.itemMasterId === item.itemMasterId)
  if (!purchaseItem || !purchase) {
    return {
      status: 'NOT_IN_PO',
      message: `"${item.name}" bukan bagian dari PO ini.`,
      item,
      convQty: 1,
      convFound: false,
    }
  }

  const vendorItems = await repo.getVendorItems(purchase.vendorId, item.itemMasterId)
  const conv = resolveConvQty(vendorItems, {
    vendorId: purchase.vendorId,
    itemMasterId: item.itemMasterId,
    uomPurchaseId: purchaseItem.uomId,
  })

  return {
    status: 'OK',
    message: conv.found
      ? item.name
      : `${item.name} (konversi satuan tidak ditemukan, dipakai faktor 1)`,
    item,
    purchaseItem,
    convQty: conv.convQty,
    convFound: conv.found,
  }
}

export interface AddScanResult {
  ok: boolean
  message: string
  resolution: ScanResolution
  line?: LocalSessionItem
}

/** FR-4.4/FR-4.5: menambahkan hasil scan ke sesi penerimaan. */
export async function addScannedItem(
  repo: LocalRepository,
  sessionId: string,
  purchaseId: string,
  scannedCode: string,
  qty: number,
): Promise<AddScanResult> {
  const resolution = await resolveScan(repo, purchaseId, scannedCode)
  if (resolution.status !== 'OK' || !resolution.item || !resolution.purchaseItem) {
    return { ok: false, message: resolution.message, resolution }
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: false, message: 'Qty harus lebih dari 0.', resolution }
  }

  const line = await repo.addOrIncrementLine(sessionId, {
    purchaseItemId: resolution.purchaseItem.purchaseItemId,
    itemMasterId: resolution.item.itemMasterId,
    barcode: scannedCode,
    qty,
    uomPurchaseId: resolution.purchaseItem.uomId,
    uomId: resolution.item.uomStockId,
    convQty: resolution.convQty,
    convFound: resolution.convFound,
  })

  return { ok: true, message: resolution.message, resolution, line }
}
