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
npm run dev            # http://localhost:3000 (--host; hanya http, TLS_* tidak berlaku. PDT di LAN: build + npm start dengan https, lihat bagian 6.1)
```

Login demo: **`pdt` / `pdt123`** (online pertama; setelah itu bisa login offline s/d 7 hari).

Barang untuk di-scan (barcode demo):
- `22001771` → SISIR ANAK SAILIYA — PO 10 KARTON (1 KARTON = 12 PCS)
- `22001773` → SISIR CARAVAN SET 4 — PO 5 PACK (1 PACK = 6 PCS)

Menjalankan seperti produksi (SPA build + server functions):

```bash
npm run build
npm start              # http://localhost:3000 (https bila TLS_CERT_FILE & TLS_KEY_FILE diisi)
```

> **Syarat produksi:** `npm start` menyetel `NODE_ENV=production` (hanya bila belum diset; `NODE_ENV` lain
> dari shell, mis. `development`, tidak ditimpa dan **mematikan** pengecekan di bawah). Dalam mode produksi
> aplikasi **menolak membuka koneksi database** bila `CREDENTIAL_HMAC_SECRET` masih nilai contoh/terlalu
> pendek (< 32 karakter) atau `DB_USER`/`DB_PASSWORD`/`DB_NAME` tidak terisi (di `.env` atau di shell).
>
> Penolakan ini baru terjadi pada permintaan database pertama (mis. login PDT), **bukan** saat `npm start`:
> server tetap menyala dan menampilkan "StockOps berjalan di ...", PDT hanya melihat "Server sedang
> bermasalah", sedangkan alasan lengkapnya (`[env] Konfigurasi produksi tidak aman: ...`) tercetak di
> konsol server. Setelah mengubah `.env`, jalankan ulang `npm start` dari **folder root proyek** (di sanalah
> `.env` dibaca). Gunakan user database khusus (bukan `root`) dengan password tidak kosong.

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
- **Riwayat dokumen & penolakan PO** (PRD 12.12): setiap dokumen yang berhasil dibuat menulis
  baris `document_history` (type 2, ref_id = receive_id). Bila server menolak sesi karena PO
  `CLOSED`/dihapus/validasi, sesi berstatus **Ditolak (REJECTED)** — tidak dihitung pada angka
  "Diterima", keluar dari antrian, bisa dihapus, dan daftar PO di-refresh otomatis.
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
- **Otorisasi perangkat:** pull, push, dan worklist over-receive wajib membawa fingerprint
  minimal satu user ter-cache yang **masih valid** (`assertAuthorizedDevice` di
  `src/server/services/auth-service.ts`). Tanpa itu, pull ditolak dan semua sesi push
  dibalas `UNAUTHORIZED` (sesi tetap di antrian device, tidak hilang). Sesi milik user yang
  kredensialnya baru dicabut tetap diterima selama perangkat masih terautentikasi.
- **Data dokumen dari PO:** `pos_receive.vendor_id`, `pos_receive.location_id` dan
  `pos_receive_item.company_id` diambil dari baris `pos_purchase`, bukan dari payload device
  (`pos_receive.company_id` tetap NULL).
- **Baris ganda dalam satu sesi** (item PO yang sama dua kali) dijumlahkan saat menilai over-receive;
  baris pengulangan hanya melaporkan kelebihan yang ditambahkannya sendiri, sehingga `excessTotal`
  sama dengan total akhir dikurangi jumlah dipesan.
- **Pemilik sesi (satu PDT dipakai bergantian):** setiap sesi menyimpan `userId` **dan** nama
  operator yang membuatnya (didenormalisasi saat sesi dibuat, jadi tetap tampil walau kredensial
  user sudah dicabut admin dan dihapus dari perangkat). Daftar Penerimaan memisahkan "Sesi saya"
  dari "Operator lain"; membuka sesi milik operator lain memunculkan konfirmasi lalu layar
  **baca-saja** — scan, ubah qty, undo, batalkan, dan finalisasi hanya untuk pemiliknya
  (`canEditSession` di `src/shared/session-owner.ts`). PO yang punya sesi berjalan milik operator
  lain **tetap** boleh diterima lewat sesi baru (dengan peringatan yang menyebut pemiliknya), dan
  **pengiriman tidak dibatasi**: tombol Kirim mendorong seluruh outbox termasuk dokumen operator
  lain, supaya dokumen final tidak tertahan menunggu pemiliknya login.

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
    env.ts                Konfigurasi lingkungan + pengecekan secret/kredensial produksi
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
    secure-context.ts     Deteksi https/localhost & ketersediaan WebCrypto
    feedback.ts, toast.ts Bunyi/getar dan notifikasi singkat
    preferences.ts        Preferensi operator (mis. input qty)
  components/             UI (keypad-first) + form login
  routes/                 Halaman: login, /pos, /pos/$id, /sessions, /sessions/$id, /settings
public/                   icon.svg, manifest.webmanifest, sw.js, offline.html
scripts/                  seed demo, setup/teardown DB uji, server produksi
tests/                    unit, server, client, component
```

---

## 5. Pengujian

`npm test` menjalankan 246 test pada 24 berkas:

| Lapisan | Berkas | Fokus |
| --- | --- | --- |
| Unit | `tests/unit/*` | ID bigint, nomor dokumen, UOM, barcode, over-receive (termasuk baris ganda), memo, angka desimal, kalkulasi finansial, validasi secret produksi, deteksi secure context |
| Server (integrasi MySQL uji) | `tests/server/auth-service`, `pull-service`, `sync-service` | login, pencabutan kredensial, **otorisasi perangkat**, pull bertahap, **idempotensi**, **over-receive lintas device**, penomoran, **rollback transaksi**, sanitasi tanggal, data dokumen dari PO |
| Klien (Dexie) | `tests/client/local-repo`, `offline-auth`, `auth-webcrypto-guard`, `sync-slice-queue`, `sync-slice-refresh` | repositori lokal (transaksi baris sesi, `markSynced` idempoten, `markFailed` tidak menimpa SYNCED), progress PO, hash & kedaluwarsa kredensial, guard WebCrypto saat login, antrean eksklusif sync/unduh/refresh PO, penanda "PO perlu diperbarui" |
| Klien ↔ server ↔ MySQL | `tests/client/sync-engine` | alur offline lengkap: pull → scan → finalisasi → sinkron → nomor resmi; replay idempoten; pencabutan kredensial; unduhan gagal atau timeout tidak menghapus data lama; hasil sinkronisasi diproses per sesi; refresh PO tidak menghapus sesi |
| Komponen UI | `tests/component/*` | komponen dasar, kontrol scan, form login, peringatan http di layar login (jsdom + Testing Library) |

> Jumlah test di atas dihitung manual dari `npm test`; perbarui bila menambah/menghapus test.

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
- Service worker didaftarkan di **semua** environment (`registerServiceWorker()` di
  `src/components/app-shell.tsx`). Perilaku offline penuh hanya terjamin pada build
  (`npm run build && npm start`); di `npm run dev` cache shell bisa basi.
- **Naikkan `CACHE_VERSION` di `public/sw.js` pada setiap rilis yang mengubah aset** lalu jalankan
  `npm run build` ulang: daftar aset (`precache-manifest.json`) hanya dibaca saat service worker
  di-`install`, dan itu hanya terjadi bila isi `sw.js` berubah. Cache versi lama dibuang otomatis
  saat versi baru aktif. PDT cukup membuka aplikasi sekali saat online, lalu memuat ulang satu kali.
- Data kerja selalu tersimpan di IndexedDB, sehingga tetap bisa dipakai walau PWA
  belum terpasang.

### 6.1 HTTPS untuk PDT (wajib di jaringan LAN)

Browser hanya menyediakan service worker dan `crypto.subtle` (dipakai untuk kredensial
offline) pada **https://** atau **localhost**. PDT yang membuka `http://<IP-komputer>`
tidak bisa login maupun bekerja offline; layar login menampilkan peringatan.

**Aturan konfigurasi**

- HTTPS hanya tersedia lewat `npm start` (bukan `npm run dev`).
- `TLS_CERT_FILE` dan `TLS_KEY_FILE` harus diisi **bersamaan** di environment shell. `scripts/serve.mjs`
  membaca environment sebelum `.env` dimuat, jadi `TLS_*` dan `PORT` **tidak** berlaku bila ditulis di `.env`.
  Sebaliknya `DB_*` dan `CREDENTIAL_HMAC_SECRET` boleh di `.env` (dibaca dari folder tempat `npm start`
  dijalankan; nilai yang sudah diset di shell menang atas `.env`).
- Bila hanya salah satu variabel `TLS_*` yang diisi, atau file tidak terbaca (path salah, tanpa hak akses,
  atau private key memakai passphrase), server **berhenti** dengan pesan `[serve] ...` di konsol dan **tidak**
  jatuh ke http. Perbaiki path/isi variabel lalu jalankan ulang.
- Kunci privat (`key.pem`), `cert.pem`, dan `rootCA-key.pem` bersifat **rahasia**: jangan di-commit atau
  dibagikan, dan simpan di folder yang hanya bisa dibaca akun yang menjalankan server.

**Contoh memakai [mkcert](https://github.com/FiloSottile/mkcert) di komputer server (Windows)**

Pasang mkcert, lalu **buka jendela PowerShell baru** agar perintah `mkcert` dikenali:

```powershell
winget install FiloSottile.mkcert
```

Pasang CA lokal di komputer server:

```powershell
mkcert -install
```

Buat folder sertifikat:

```powershell
New-Item -ItemType Directory -Force C:\stockops-cert
```

Buat sertifikat (ganti `192.168.1.10` dengan IP komputer server, sebaiknya IP statis):

```powershell
mkcert -cert-file C:\stockops-cert\cert.pem -key-file C:\stockops-cert\key.pem 192.168.1.10 localhost
```

Jalankan server (variabel `$env:` hanya berlaku di jendela PowerShell yang sama; bila server dijalankan
lewat Task Scheduler atau layanan Windows, set variabelnya di sana):

```powershell
$env:TLS_CERT_FILE='C:\stockops-cert\cert.pem'; $env:TLS_KEY_FILE='C:\stockops-cert\key.pem'; npm start
```

Izinkan port 3000 di Windows Firewall (profil jaringan Private), kalau tidak PDT tidak bisa terhubung.

Di setiap PDT, pasang sertifikat CA mkcert sebagai sertifikat tepercaya: salin **hanya** file
`rootCA.pem` dari folder yang ditampilkan `mkcert -CAROOT` (jangan salin `rootCA-key.pem`) ke perangkat, lalu
pasang lewat Pengaturan → Keamanan → Enkripsi & kredensial → Instal sertifikat → Sertifikat CA (nama
menu berbeda antar versi Android, dan Android umumnya meminta kunci layar PIN/pola lebih dulu).
Setelah itu buka `https://192.168.1.10:3000` di Chrome dan pastikan halaman terbuka tanpa peringatan sertifikat.

**Perawatan:** sertifikat mkcert punya masa berlaku (tanggal kedaluwarsanya ditampilkan mkcert saat
membuatnya). Buat ulang sertifikat dengan perintah yang sama bila mendekati kedaluwarsa atau IP server
berganti, lalu jalankan ulang `npm start`; sertifikat hanya dibaca saat server dijalankan.

### 6.2 Mengganti secret & merilis versi baru

- **Mengganti `CREDENTIAL_HMAC_SECRET`** membuat semua fingerprint kredensial di semua PDT tidak cocok lagi:
  semua operator ter-logout, login offline hilang, dan pull/push ditolak sampai **satu user login online
  ulang** di perangkat itu. Sesi penerimaan yang belum terkirim **tetap aman** di antrian perangkat dan
  terkirim setelah login ulang. Beri tahu operator sebelum mengganti secret.
- **Setelah rilis baru:** buka aplikasi di PDT sekali saat online agar service worker memuat versi baru, lalu
  muat ulang satu kali. Perangkat yang masih menjalankan versi lama (sebelum otorisasi perangkat) akan
  ditolak saat pull/push sampai halaman dimuat ulang.

### Mode kontras tinggi

Pengaturan → Tampilan → **Kontras tinggi**. Ditujukan untuk gudang atau dok bongkar yang terang:
permukaan tembus pandang dibuat pekat, garis batas dipertegas, teks keterangan dinaikkan ke putih, dan
cincin fokus dipertebal. Pilihannya disimpan per perangkat di `localStorage`
(`stockops.preferences`, field `highContrast`) dan diterapkan sebagai atribut
`data-contrast="high"` pada elemen `<html>`.

Ini **bukan** tema terang. Warna aplikasi ditulis sebagai kelas Tailwind `slate-*` yang tersebar di
seluruh komponen, sehingga tema terang penuh menuntut migrasi kelas-kelas itu menjadi kelas semantik —
pekerjaan terpisah yang belum dijadwalkan.

## 7. Keterbatasan yang Disadari

- Target perangkat (varian GMS/non-GMS, versi Android) masih perlu dikonfirmasi.
- Toleransi over-receive untuk barang timbangan belum ada (sesuai keputusan fase ini).
- Filter penerimaan per lokasi belum ada (BR-13).
- Pengesahan/persetujuan over-receive dilakukan di website admin (di luar aplikasi ini);
  aplikasi hanya menandai dan menyediakan `overReceiveWorklist` untuk verifikasi.
- Otorisasi bersifat per **perangkat**: `userId` di payload sesi belum dicocokkan dengan kredensial yang
  terautentikasi, jadi perangkat yang memegang satu kredensial valid secara teknis bisa mengirim sesi atas
  nama user lain (jejak `pos_receive.user_id`). Perlu keputusan produk bila dianggap risiko.
- **Penanda pemilik sesi adalah pencegah kekeliruan, bukan kontrol akses.** Seluruh aturannya
  berjalan di perangkat (`src/shared/session-owner.ts` + layar sesi); server tidak memeriksa pemilik
  sesi sama sekali, sehingga keterbatasan `userId` pada butir di atas tetap berlaku utuh.
- Sesi **berjalan** milik operator yang tidak kembali (mis. kredensialnya dicabut admin) tidak bisa
  dilanjutkan, diambil alih, atau dihapus oleh operator lain. Sesi itu menetap di perangkat, dan
  qty-nya tetap ikut dihitung pada progres PO lokal — PO-nya masih bisa diterima lewat sesi baru,
  dan layar detail PO menyebutkan asal angkanya. Fitur ambil-alih/purge belum dijadwalkan.
- Percobaan login online belum dibatasi (tanpa rate limit/lockout) dan password `sysuser` bersifat
  plaintext (legacy sistem admin).
