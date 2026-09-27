# StockOps — Aplikasi Penerimaan Barang Berbasis PO (Offline-First)

Implementasi dari `PRD_Penerimaan_Barang_PDT.md` dan `BRD_Penerimaan_Barang_PDT.md`.

Aplikasi web (PWA) untuk operator gudang memakai **PDT (Portable Data Terminal)** — perangkat apa pun yang
mendukung browser modern: mencatat barang
datang berdasarkan **Purchase Order (PO)** milik sistem admin yang sudah ada.
Seluruh fungsi inti berjalan **tanpa internet**; data disimpan di perangkat (IndexedDB),
lalu dikirim ke database pusat saat online.

- Template database: MySQL/MariaDB (diuji pada **MariaDB 10.4**, kompatibel dengan MySQL 5.x).
- Stack: React + Vite + Tailwind CSS + TanStack Start (Router + server functions) +
  Drizzle ORM + Zod + Dexie.
- Perilaku PWA: service worker manual (`public/sw.js`) + manifest.

---

## 1. Cara Menjalankan (siap pakai)

Prasyarat: Node.js ≥ 20, MySQL/MariaDB berjalan di `localhost:3306`.

```bash
# 1) Konfigurasi (sudah tersedia .env default; salin dari .env.example bila perlu)
#    DB_HOST=127.0.0.1  DB_NAME=demo  DB_USER=root  DB_PASSWORD=root

# 2) Siapkan data demo (membuat 1 PO CHECKED, vendor, konversi satuan, user PDT)
npm run db:seed

# 3) Jalankan mode pengembangan
npm run dev            # http://localhost:3000 (--host, bisa diakses dari PDT di LAN)
```

Login demo: **`pdt` / `pdt123`** (online pertama; setelah itu bisa login offline s/d 7 hari).

Barang untuk di-scan (barcode demo):
- `22001771` → SISIR ANAK SAILIYA — PO 10 KARTON (1 KARTON = 12 PCS)
- `22001773` → SISIR CARAVAN SET 4 — PO 5 PACK (1 PACK = 6 PCS)

Menjalankan seperti produksi (SPA build + server functions):

```bash
npm run build
npm start              # http://localhost:3000
```

Menghapus data demo: `npm run db:seed:clean`.

> **Catatan DB:** `.env` menunjuk database `demo`. Aplikasi **tidak mengubah struktur
> (schema)** tabel admin (BR-18) — hanya membaca/menulis baris pada tabel yang sudah ada.
> Seluruh test otomatis memakai schema terpisah `stockops_test` dan **tidak menyentuh `demo`**.

---

## 2. Perintah Penting

| Perintah | Kegunaan |
| --- | --- |
| `npm run dev` | Jalankan aplikasi (dev server). |
| `npm run build` / `npm start` | Build produksi lalu jalankan server (static + `_serverFn`). |
| `npm run typecheck` | Pemeriksaan tipe (strict). |
| `npm test` | Seluruh test (unit + integrasi server + klien + komponen). |
| `npm run test:coverage` | Test + laporan cakupan. |
| `npm run db:test:setup` / `db:test:teardown` | Buat/hapus schema uji `stockops_test`. |
| `npm run db:seed` / `npm run db:seed:clean` | Pasang/hapus data demo pada DB `demo`. |

---

## 3. Arsitektur & Keputusan Penting

### 3.1 Alur data

```
PDT (PWA)                         Server (TanStack Start)            Database admin
──────────                        ───────────────────────            ──────────────
Dexie (IndexedDB)  ──pull──▶  server functions ──Drizzle/SQL──▶  pos_purchase (CHECKED)
  master & PO                   pullChunk (bertahap)                pos_purchase_item
  sesi DRAFT  ──push──▶  syncPush (transaksi) ─────────────▶  pos_receive   (DRAFT)
  outbox                       - buat receive_id & nomor           pos_receive_item
  kredensial                   - validasi over-receive agregat
                               - anti-duplikasi (idempoten) ◀──── balasan: ID & nomor resmi
```

Prinsip yang dijaga: **server adalah sumber kebenaran** (P-2), **idempoten** (P-3),
**tidak mengubah sistem admin** (P-4).

### 3.2 Aturan yang diimplementasikan

- **Hanya PO `CHECKED`** yang ditarik & diproses (BR-1, BR-13 tanpa filter lokasi).
- **PDT hanya membuat `DRAFT`** (BR-2).
- **Satu sesi = satu `pos_receive`** (BR-3); satu PO boleh banyak sesi/device (BR-4).
- **qty diinput dalam satuan PO**; `qty_purchase` disimpan = `conv_qty` vendor-item dan
  `conv_unit` = 1 (rasio konversi), default 1 dengan penanda bila konversi tidak ditemukan
  (BR-7, PRD 12.4).
- **Finansial dokumen dihitung ulang saat sinkronisasi** (PRD 12.11): `amount`,
  `discount_amount`, `total_amount` pada `pos_receive_item` dihitung dari data PO (diskon
  diprorata terhadap qty diterima); `total_amount`, `discount_total`, `total_tax` pada
  `pos_receive` dihitung ulang (pajak mengikuti `price_include_tax` PO); `type = 1`,
  `company_id` = NULL, `approval_1..3 = 0`, `pos_receive_item.status` = NULL. Pembulatan
  2 desimal (round half-up).
- **ID & nomor dibuat server saat sinkronisasi** (BR-8, BR-17):
  `receive_id = (millis + 2^56 × appIdx) × 10 + digitAcak`, **appIdx PDT = 2**
  (admin = 1) sehingga tidak mungkin bertabrakan. Nomor `IN<MMYY><0001>` memakai
  `counter` per bulan.
- **Bigint selalu string/BigInt** (BR-12). Ini bukan teori: ID unit nyata
  (`504404793498968532`) lebih besar dari `2^53`, sehingga bila dikirim sebagai
  `number` akan kehilangan presisi.
- **Over-receive tidak ditolak** (BR-5): total lintas semua dokumen dihitung server,
  item yang melebihi ditandai dan menunggu persetujuan admin (F6).
- **Login offline maksimal 7 hari** (BR-10) + **pencabutan kredensial** saat password/login_id
  berubah di `sysuser`, berlaku untuk semua user ter-cache (BR-19), dideteksi server
  memakai fingerprint HMAC (password plaintext tidak pernah dikirim/di-cache).

### 3.3 Keputusan untuk celah yang ada di PRD (didokumentasikan, bukan disembunyikan)

| Celah pada dokumen | Keputusan implementasi |
| --- | --- |
| Idempotensi tanpa ubah schema | UUID sesi disimpan pada kolom **`pos_receive.note`** dengan konvensi `PDT\|SESS=<uuid>;DEV=…;USR=…`, lalu dicari pada rentang ID namespace PDT (pakai PK) dan dicocokkan **persis**. Aman dikirim ulang (FR-5.3). |
| Penandaan over-receive | Kolom **`pos_receive_item.memo`** (varchar 120) dengan konvensi `PDT\|OVER;ORD=…;TOT=…;EXC=…` (FR-6.2). |
| Jam device salah | Tanggal penerimaan device disanitasi: bila di masa depan (>1 hari) atau terlalu lampau (>45 hari), dipakai waktu server (fungsi `sanitizeReceiveDate`). |
| Aturan pembatalan sesi final | Sesi yang belum difinalisasi boleh dibatalkan (hapus lokal). Sesi final belum tersinkron tidak dihapus otomatis. |
| Pencarian saat barcode rusak (B-4) | Selain `barcode`/`barcode_2`/`barcode_3`, pencarian juga mencocokkan kolom `code` barang. |
| Barcode ganda antar baris PO | Jika satu barang muncul di lebih dari satu baris PO, dicocokkan ke baris pertama yang ditemukan. |

### 3.4 Kepatuhan tanpa mengubah schema

Definisi tabel pada `src/server/db/schema.ts` **meniru DDL admin** (hanya kolom yang
dipakai; kolom lain mengikuti default database). Tidak ada migrasi/Drizzle Kit yang
dijalankan terhadap `demo`. Pembuatan schema uji menyalin DDL asli via `SHOW CREATE TABLE`
lalu melepas foreign key agar tidak bergantung tabel lain.

---

## 4. Struktur Proyek

```
src/
  shared/                 Logika murni (dipakai server & klien)
    ids.ts                Skema ID admin (bigint), IdGenerator monotonik
    doc-number.ts         Nomor dokumen IN<MMYY><NNNN>
    uom.ts                Resolusi conv_qty (BR-7)
    barcode.ts            Pencocokan barcode/barcode_2/barcode_3/kode
    over-receive.ts       Perhitungan over-receive
    memo.ts               Konvensi kolom note/memo
    receive-date.ts       Sanitasi tanggal penerimaan
    schemas.ts            Kontrak Zod (server functions)
    constants.ts, num.ts, format.ts, uuid.ts
  server/
    env.ts                Konfigurasi lingkungan
    db/                   client (pool+Drizzle), schema, cache, rows, sql-utils
    auth/credentials.ts   Fingerprint HMAC & verifikasi password legacy
    services/             auth-service, pull-service, sync-service
    functions/            Server functions (auth, data, sync)
  client/
    db/                   Dexie (local-db) & LocalRepository
    auth/offline-auth.ts  Hash PBKDF2 + verifikasi offline + kedaluwarsa
    sync/                 transport (server functions) + engine (pull/push)
    services/scanning.ts  Scan → item + baris PO + konversi
    state/store/           Store Zustand (slice auth, sync, app) + provider SSR-safe
    hooks/use-live.ts     Pembungkus useLiveQuery yang aman untuk SPA
    pwa.ts                Registrasi service worker
  components/             UI (keypad-first) + form login
  routes/                 Halaman: login, /pos, /pos/$id, /sessions, /sessions/$id, /settings
public/                   icon.svg, manifest.webmanifest, sw.js, offline.html
scripts/                  seed demo, setup/teardown DB uji, server produksi
tests/                    unit, server, client, component
```

---

## 5. Pengujian

`npm test` menjalankan 150 test pada 15 berkas:

| Lapisan | Berkas | Fokus |
| --- | --- | --- |
| Unit | `tests/unit/*` | ID bigint, nomor dokumen, UOM, barcode, over-receive, memo, angka desimal |
| Server (integrasi MySQL uji) | `tests/server/auth-service`, `pull-service`, `sync-service` | login, pencabutan kredensial, pull bertahap, **idempotensi**, **over-receive lintas device**, penomoran, **rollback transaksi**, sanitasi tanggal |
| Klien (Dexie) | `tests/client/local-repo`, `offline-auth` | repositori lokal, progress PO, hash & kedaluwarsa kredensial |
| Klien ↔ server ↔ MySQL | `tests/client/sync-engine` | alur offline lengkap: pull → scan → finalisasi → sinkron → nomor resmi; replay idempoten; pencabutan kredensial; refresh PO tidak menghapus sesi |
| Komponen UI | `tests/component/*` | komponen dasar & form login (jsdom + Testing Library) |

Contoh perilaku yang diuji secara eksplisit:

- Mengirim ulang sesi yang sama **tidak** menghasilkan dokumen ganda (Skenario C).
- Dua device menerima 6 dan 5 dari 10 → item ditandai over-receive sebesar 1, dokumen tetap `DRAFT`, muncul di worklist (Skenario B).
- Bila satu item gagal disimpan, **seluruh** dokumen dibatalkan (FR-5.7).
- `conv_qty` 12 → `qty_purchase` = 12 dan `conv_unit` = 1 (BR-7).
- `amount` 100000 & diskon item 39403.99 (dipesan 10) → terima 6 → `total_amount` 576357.61 dan `total_tax` 63399.34 (PRD 12.11).
- ID yang dibuat berada di namespace appIdx 2 dan **tidak pernah** masuk rentang appIdx 1 (BR-17).

---

## 6. PWA & Offline

- `public/sw.js` menyimpan shell SPA + aset statis; navigasi network-first dengan
  fallback shell. Panggilan `/_serverFn/*` dan `/api/*` selalu **network-only**.
- Service worker hanya didaftarkan pada build produksi (`npm run build && npm start`).
- Data kerja selalu tersimpan di IndexedDB, sehingga tetap bisa dipakai walau PWA
  belum terpasang.

## 7. Keterbatasan yang Disadari

- Target perangkat (varian GMS/non-GMS, versi Android) masih perlu dikonfirmasi.
- Toleransi over-receive untuk barang timbangan belum ada (sesuai keputusan fase ini).
- Filter penerimaan per lokasi belum ada (BR-13).
- Pengesahan/persetujuan over-receive dilakukan di website admin (di luar aplikasi ini);
  aplikasi hanya menandai dan menyediakan `overReceiveWorklist` untuk verifikasi.
