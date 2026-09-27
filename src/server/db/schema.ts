/**
 * Skema Drizzle untuk tabel EXISTING sistem admin (BR-18).
 *
 * Definisi di sini SENGAJA hanya mencakup kolom yang dibaca/ditulis aplikasi.
 * Tabel aslinya TIDAK diubah: kita tidak menjalankan migrasi/Drizzle Kit.
 * Kolom yang tidak dideklarasikan tetap memakai nilai default dari database
 * saat INSERT.
 *
 * bigint memakai mode 'bigint' (BUKAN number) agar presisi terjaga (BR-12).
 */

import {
  bigint,
  date,
  datetime,
  decimal,
  int,
  mysqlTable,
  text,
  varchar,
} from 'drizzle-orm/mysql-core'

export const posPurchase = mysqlTable('pos_purchase', {
  purchaseId: bigint('purchase_id', { mode: 'bigint' }).primaryKey(),
  number: varchar('number', { length: 20 }),
  status: varchar('status', { length: 20 }),
  vendorId: bigint('vendor_id', { mode: 'bigint' }),
  locationId: bigint('location_id', { mode: 'bigint' }),
  userId: bigint('user_id', { mode: 'bigint' }),
  companyId: bigint('company_id', { mode: 'bigint' }),
  purchDate: datetime('purch_date', { mode: 'string' }),
  totalAmount: decimal('total_amount', { precision: 25, scale: 2 }),
  note: text('note'),
  includeTax: int('include_tax'),
  taxPercent: decimal('tax_percent', { precision: 10, scale: 2 }),
  discountPercent: decimal('discount_percent', { precision: 10, scale: 2 }),
  paymentType: varchar('payment_type', { length: 20 }),
  currencyId: bigint('currency_id', { mode: 'bigint' }),
  priceIncludeTax: int('price_include_tax'),
})

export const posPurchaseItem = mysqlTable('pos_purchase_item', {
  purchaseItemId: bigint('purchase_item_id', { mode: 'bigint' }).primaryKey(),
  purchaseId: bigint('purchase_id', { mode: 'bigint' }),
  itemMasterId: bigint('item_master_id', { mode: 'bigint' }),
  qty: decimal('qty', { precision: 10, scale: 2 }),
  uomId: bigint('uom_id', { mode: 'bigint' }),
  status: varchar('status', { length: 45 }),
  amount: decimal('amount', { precision: 25, scale: 2 }),
  discountAmount: decimal('discount_amount', { precision: 25, scale: 2 }),
})

export const posReceive = mysqlTable('pos_receive', {
  receiveId: bigint('receive_id', { mode: 'bigint' }).primaryKey(),
  status: varchar('status', { length: 20 }),
  note: text('note'),
  locationId: bigint('location_id', { mode: 'bigint' }),
  userId: bigint('user_id', { mode: 'bigint' }),
  number: varchar('number', { length: 20 }),
  counter: int('counter'),
  vendorId: bigint('vendor_id', { mode: 'bigint' }),
  date: datetime('date', { mode: 'string' }),
  prefixNumber: varchar('prefix_number', { length: 20 }),
  purchaseId: bigint('purchase_id', { mode: 'bigint' }),
  dueDate: date('due_date', { mode: 'string' }),
  invoiceNumber: varchar('invoice_number', { length: 45 }),
  doNumber: varchar('do_number', { length: 45 }),
  companyId: bigint('company_id', { mode: 'bigint' }),
  createdAt: datetime('created_at', { mode: 'string' }),
  approval1: bigint('approval_1', { mode: 'bigint' }),
  approval2: bigint('approval_2', { mode: 'bigint' }),
  approval3: bigint('approval_3', { mode: 'bigint' }),
  includeTax: int('include_tax'),
  totalTax: decimal('total_tax', { precision: 25, scale: 2 }),
  totalAmount: decimal('total_amount', { precision: 25, scale: 2 }),
  taxPercent: decimal('tax_percent', { precision: 10, scale: 2 }),
  discountPercent: decimal('discount_percent', { precision: 10, scale: 2 }),
  discountTotal: decimal('discount_total', { precision: 25, scale: 2 }),
  paymentType: varchar('payment_type', { length: 20 }),
  currencyId: bigint('currency_id', { mode: 'bigint' }),
  priceIncludeTax: int('price_include_tax'),
  type: int('type'),
})

export const posReceiveItem = mysqlTable('pos_receive_item', {
  receiveItemId: bigint('receive_item_id', { mode: 'bigint' }).primaryKey(),
  itemMasterId: bigint('item_master_id', { mode: 'bigint' }),
  qty: decimal('qty', { precision: 10, scale: 2 }),
  uomId: bigint('uom_id', { mode: 'bigint' }),
  receiveId: bigint('receive_id', { mode: 'bigint' }),
  purchaseItemId: bigint('purchase_item_id', { mode: 'bigint' }),
  status: varchar('status', { length: 45 }),
  memo: varchar('memo', { length: 120 }),
  convUnit: decimal('conv_unit', { precision: 22, scale: 2 }),
  uomPurchaseId: bigint('uom_purchase_id', { mode: 'bigint' }),
  qtyPurchase: decimal('qty_purchase', { precision: 22, scale: 2 }),
  companyId: bigint('company_id', { mode: 'bigint' }),
  totalAmount: decimal('total_amount', { precision: 25, scale: 2 }),
  amount: decimal('amount', { precision: 25, scale: 2 }),
  discountAmount: decimal('discount_amount', { precision: 25, scale: 2 }),
  deliveryDate: datetime('delivery_date', { mode: 'string' }),
  expiredDate: date('expired_date', { mode: 'string' }),
  apCoaId: bigint('ap_coa_id', { mode: 'bigint' }),
  type: int('type'),
  isBonus: int('is_bonus'),
  priceImport: decimal('price_import', { precision: 25, scale: 2 }),
  transport: decimal('transport', { precision: 25, scale: 2 }),
  bea: decimal('bea', { precision: 25, scale: 2 }),
  komisi: decimal('komisi', { precision: 25, scale: 2 }),
  lainLain: decimal('lain_lain', { precision: 25, scale: 2 }),
  segment1Id: bigint('segment1_id', { mode: 'bigint' }),
  dis1Percent: decimal('dis_1_percent', { precision: 10, scale: 2 }),
  dis1Val: decimal('dis_1_val', { precision: 25, scale: 2 }),
  dis2Percent: decimal('dis_2_percent', { precision: 10, scale: 2 }),
  dis2Val: decimal('dis_2_val', { precision: 25, scale: 2 }),
  dis3Percent: decimal('dis_3_percent', { precision: 10, scale: 2 }),
  dis3Val: decimal('dis_3_val', { precision: 25, scale: 2 }),
  dis4Percent: decimal('dis_4_percent', { precision: 10, scale: 2 }),
  dis4Val: decimal('dis_4_val', { precision: 25, scale: 2 }),
  expiredCheckStatus: int('expired_check_status'),
  expiredCheckId: bigint('expired_check_id', { mode: 'bigint' }),
})

export const posItemMaster = mysqlTable('pos_item_master', {
  itemMasterId: bigint('item_master_id', { mode: 'bigint' }).primaryKey(),
  code: varchar('code', { length: 20 }),
  barcode: varchar('barcode', { length: 20 }),
  barcode2: varchar('barcode_2', { length: 20 }),
  barcode3: varchar('barcode_3', { length: 20 }),
  name: varchar('name', { length: 120 }),
  uomStockId: bigint('uom_stock_id', { mode: 'bigint' }),
  uomPurchaseId: bigint('uom_purchase_id', { mode: 'bigint' }),
  isActive: int('is_active'),
})

export const posUnit = mysqlTable('pos_unit', {
  uomId: bigint('uom_id', { mode: 'bigint' }).primaryKey(),
  unit: varchar('unit', { length: 20 }),
  companyId: bigint('company_id', { mode: 'bigint' }),
})

export const vendor = mysqlTable('vendor', {
  vendorId: bigint('vendor_id', { mode: 'bigint' }).primaryKey(),
  code: varchar('code', { length: 20 }),
  name: varchar('name', { length: 500 }),
  dueDate: int('due_date'),
  companyId: bigint('company_id', { mode: 'bigint' }),
})

export const posVendorItem = mysqlTable('pos_vendor_item', {
  vendorItemId: bigint('vendor_item_id', { mode: 'bigint' }).primaryKey(),
  itemMasterId: bigint('item_master_id', { mode: 'bigint' }),
  vendorId: bigint('vendor_id', { mode: 'bigint' }),
  uomPurchase: bigint('uom_purchase', { mode: 'bigint' }),
  convQty: decimal('conv_qty', { precision: 22, scale: 2 }),
  companyId: bigint('company_id', { mode: 'bigint' }),
})

export const sysuser = mysqlTable('sysuser', {
  userId: bigint('user_id', { mode: 'bigint' }).primaryKey(),
  loginId: varchar('login_id', { length: 20 }),
  password: varchar('password', { length: 32 }),
  fullName: varchar('full_name', { length: 64 }),
  companyId: bigint('company_id', { mode: 'bigint' }),
})
