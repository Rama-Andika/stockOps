# PRD — Aplikasi Penerimaan Barang Berbasis Purchase Order (Offline-First untuk PDT)

## Informasi Dokumen

| Item | Keterangan |
| --- | --- |
| Nama Dokumen | Product Requirements Document (PRD) |
| Nama Produk | Aplikasi Penerimaan Barang (Goods Receipt) Berbasis Purchase Order — Offline-First |
| Versi | 1.2 |
| Tanggal | 26 September 2026 |
| Status | Draft untuk review |
| Perangkat Target | PDT (Portable Data Terminal) — perangkat Android apa pun |
| Teknologi | React JS, Vite, Tailwind CSS, TanStack Start, TanStack Router, Drizzle, Zod, Dexie, MySQL 5.x |

---

## 1. Ringkasan Eksekutif

Aplikasi ini adalah **aplikasi web (PWA) offline-first** yang digunakan oleh operator gudang melalui **PDT (Portable Data Terminal)** untuk mencatat barang yang datang ke gudang berdasarkan **Purchase Order (PO)**.

Prinsip utamanya: **aplikasi harus tetap bisa digunakan secara penuh tanpa koneksi internet.** Data disimpan terlebih dahulu di device (lokal), lalu dikirim (disinkronkan) ke database pusat ketika koneksi tersedia kembali.

Aplikasi ini **tidak membuat PO**. PO dibuat oleh sistem admin yang sudah ada. Aplikasi hanya:

1. Menarik daftar PO yang berstatus `CHECKED` dari database (saat online).
2. Mencatat penerimaan barang (receiving) atas PO tersebut (bisa saat offline).
3. Mengirim catatan penerimaan ke database pusat (saat online).

---

## 2. Latar Belakang & Masalah

- Proses penerimaan barang dilakukan di area gudang yang **konektivitasnya tidak stabil atau sering tidak ada**.
- Sistem pencatatan yang ada saat ini berbasis website yang **wajib online**, sehingga pekerjaan terhambat setiap kali koneksi putus.
- Dibutuhkan pencatatan yang **cepat berbasis scan barcode** menggunakan perangkat genggam.
- Data penerimaan harus tetap masuk ke **database pusat (sistem admin) yang sudah ada**, **tanpa mengubah struktur datanya**.

---

## 3. Tujuan (Goals)

| ID | Tujuan |
| --- | --- |
| G-1 | Operator dapat **login dan menerima barang tanpa koneksi internet**. |
| G-2 | Hasil penerimaan **tersinkron otomatis** ke database pusat saat online, **tanpa duplikasi** dan **tanpa tabrakan ID**. |
| G-3 | Akurasi kuantitas terjaga: penerimaan yang melebihi pesanan **tidak boleh lolos tanpa kontrol** (ditandai dan menunggu persetujuan admin). |
| G-4 | **Satu PO boleh dikerjakan oleh beberapa PDT** secara bersamaan. |
| G-5 | Pengalaman pakai cocok untuk **layar kecil dan keypad** perangkat PDT. |

---

## 4. Non-Tujuan (Out of Scope)

Hal-hal berikut **tidak termasuk** dalam aplikasi ini:

- **Tidak ada fitur membuat atau mengedit PO.**
- **Tidak ada proses `APPROVED` / `CHECKED`** untuk dokumen penerimaan — proses tersebut dilakukan di website admin yang sudah ada. Aplikasi ini hanya membuat dokumen berstatus `DRAFT`.
- **Tidak mengubah struktur (schema) database admin** — hanya membaca dan menulis tabel yang sudah ada.
- **Filter penerimaan per lokasi belum dibuat** — untuk saat ini semua PO `CHECKED` ditarik tanpa melihat lokasi. Fitur ini direncanakan menyusul.
- **Tidak mengubah kebiasaan penyimpanan password di sistem admin** (catatan: password saat ini disimpan plain text di sistem legacy; risikonya dicatat di bagian Risiko).

---

## 5. Persona Pengguna

| Persona | Deskripsi | Kebutuhan Utama |
| --- | --- | --- |
| **Operator Gudang** | Pengguna PDT di area penerimaan barang | Login (termasuk offline), melihat daftar PO, scan barcode barang, input qty, input nomor invoice & DO, melihat status sinkronisasi |
| **Admin** | Pengguna website admin yang sudah ada | Melihat dokumen penerimaan hasil sinkronisasi, menyetujui/menolak over-receive, melakukan proses `APPROVED` dan `CHECKED` |
| **Tim IT** | Pihak yang mengelola device & infrastruktur | Konfigurasi perangkat PDT (termasuk scanner/keyboard input), pemasangan aplikasi PWA, alokasi ID node (appIdx) |

---

## 6. Glosarium

| Istilah | Arti |
| --- | --- |
| **PDT** | Portable Data Terminal — komputer genggam untuk scan barcode (dalam proyek ini: perangkat PDT apa pun yang mendukung browser modern). |
| **PO / Purchase Order** | Dokumen pesanan pembelian ke vendor; menjadi acuan penerimaan barang. |
| **CHECKED** | Status PO yang berarti sudah disetujui dan **siap dikerjakan penerimaannya**. |
| **Receive / Penerimaan** | Catatan barang yang datang (tabel `pos_receive` + `pos_receive_item`). |
| **DRAFT** | Status dokumen penerimaan yang dibuat dari PDT (belum disetujui admin). |
| **UOM** | *Unit of Measure* — satuan barang. |
| **Purchase UOM** | Satuan pembelian yang dipakai di PO (contoh: karton). |
| **Stock UOM** | Satuan stok terkecil di gudang (contoh: pcs). |
| **conv_qty** | Faktor konversi purchase UOM → stock UOM, diambil dari tabel `pos_vendor_item`. |
| **Outbox** | Antrian data lokal di device yang menunggu dikirim ke server. |
| **Sync / Sinkronisasi** | Proses mengirim data lokal ke server dan/atau menarik data baru dari server. |
| **Over-receive** | Kondisi total barang yang diterima **melebihi** jumlah yang dipesan. |
| **Sesi Penerimaan** | Satu kegiatan scan dari mulai sampai finalisasi; **satu sesi = satu dokumen `pos_receive`**. |

---

## 7. Prinsip Desain

| ID | Prinsip | Penjelasan |
| --- | --- | --- |
| P-1 | **Offline-first** | Semua fungsi inti (login, lihat PO, scan, input, simpan) berjalan tanpa internet. Online hanya diperlukan untuk: login pertama di sebuah device, tarik data, dan sinkronisasi. |
| P-2 | **Server adalah sumber kebenaran** | Perhitungan "sisa yang belum diterima" dan deteksi over-receive dilakukan di **server saat sinkronisasi**, bukan di device — supaya semua device konsisten. |
| P-3 | **Anti-duplikasi (idempoten)** | Sinkronisasi aman diulang: kirim ulang data yang sama **tidak boleh** menghasilkan data ganda. |
| P-4 | **Tidak merusak sistem admin** | Hanya membaca/menulis tabel yang sudah ada di database admin. Tidak mengubah schema, tidak mengubah data yang bukan milik aplikasi ini. |
| P-5 | **Ramah device gudang** | UI dirancang untuk layar kecil + keypad: font besar, tombol besar, navigasi keyboard, scan barcode secepat mungkin, minim ketikan manual. |

---

## 8. Alur Utama (Ringkasan)

Berikut alur hidup aplikasi secara garis besar:

1. **Login pertama (wajib online)** — Operator login dengan ID dan password ke sistem. Setelah berhasil, device menyimpan sesi lokal supaya login berikutnya bisa offline.
2. **Unduh data (otomatis setelah login pertama)** — Device menarik: semua PO berstatus `CHECKED` beserta item-nya, master barang aktif, satuan (unit), vendor, dan data vendor-item. Semua tersimpan lokal di device.
3. **Terima barang (offline)** — Operator memilih PO, membuat sesi penerimaan, scan barcode barang, input qty, dan input nomor invoice & DO. Data tersimpan lokal sebagai `DRAFT` dan masuk antrian sinkronisasi.
4. **Sinkronisasi (saat online)** — Device mengirim sesi yang belum tersinkron ke server. Server membuat nomor dokumen & ID resmi, memvalidasi kuantitas (termasuk over-receive), menyimpan ke database, lalu mengembalikan hasilnya ke device.
5. **Tindak lanjut admin** — Dokumen penerimaan muncul di website admin sebagai `DRAFT`. Admin melakukan verifikasi, termasuk menyetujui over-receive bila ada, lalu melanjutkan proses `APPROVED` / `CHECKED`.

---

## 9. Kebutuhan Fungsional

Setiap kebutuhan fungsional diberi ID `FR-<fitur>.<nomor>` dan ditulis dalam bentuk **cerita pengguna** (user story) + **kriteria penerimaan** (acceptance criteria) supaya mudah dipahami dan mudah diuji.

### F1 — Autentikasi & Login

#### FR-1.1 — Login online (pertama kali di sebuah device)
**Cerita pengguna:** Sebagai operator gudang, saya ingin masuk menggunakan ID dan password saya, sehingga saya dapat menggunakan aplikasi.

**Kriteria penerimaan:**
- Operator memasukkan `login_id` dan `password`, diverifikasi ke tabel `sysuser`.
- Jika cocok dan user aktif, login berhasil; jika salah, muncul pesan yang jelas.
- Setelah login berhasil, aplikasi menyimpan di device (lokal): identitas user, data perusahaan, dan **kredensial lokal** untuk login offline berikutnya.
- Password **tidak boleh disimpan sebagai teks biasa** di device — hanya dalam bentuk hash dengan salt lokal.

#### FR-1.2 — Login offline
**Cerita pengguna:** Sebagai operator gudang, saya ingin tetap bisa login meskipun tidak ada koneksi internet, sehingga pekerjaan tidak terhenti.

**Kriteria penerimaan:**
- Jika device sudah pernah login online oleh user tersebut dan belum kedaluwarsa, login offline harus berhasil tanpa koneksi.
- Verifikasi offline dilakukan terhadap kredensial lokal yang tersimpan (bandingkan hash, bukan teks biasa).
- Jika user belum pernah login di device tersebut atau sesinya kedaluwarsa, login offline ditolak dengan pesan "wajib login online".

#### FR-1.3 — Batas waktu re-autentikasi (7 hari)
**Cerita pengguna:** Sebagai pemilik bisnis, saya ingin operator wajib login online secara berkala, sehingga keamanan tetap terjaga.

**Kriteria penerimaan:**
- Sesi lokal berlaku maksimal **7 hari** sejak login online terakhir.
- Setelah 7 hari, login offline ditolak; operator wajib login online kembali.
- Sisa hari berlaku sesi ditampilkan (atau peringatan mendekati kedaluwarsa).

#### FR-1.4 — Login di device mana pun
**Cerita pengguna:** Sebagai operator gudang, saya ingin bisa login di PDT mana pun, sehingga saya fleksibel bertugas.

**Kriteria penerimaan:**
- Tidak ada penguncian akun ke satu device tertentu.
- Kredensial offline disimpan **per device**: user yang sama bisa login di banyak device, dan satu device bisa dipakai banyak user.
- Tiap pasangan (device, user) punya catatan kedaluwarsanya sendiri.

#### FR-1.5 — Logout
**Cerita pengguna:** Sebagai operator gudang, saya ingin bisa keluar dari aplikasi, sehingga device aman saat berpindah tangan.

**Kriteria penerimaan:**
- Tombol logout tersedia.
- Setelah logout, data lokal tetap tersimpan (tidak terhapus), namun akses aplikasi terkunci sampai login berikutnya.

#### FR-1.6 — Pencabutan kredensial saat terjadi perubahan
**Cerita pengguna:** Sebagai pemilik bisnis, saya ingin perubahan `login_id`/`password` seorang user di sistem admin dicabut dari semua device pada sinkronisasi berikutnya, sehingga kredensial lama tidak bisa dipakai lagi.

**Kriteria penerimaan:**
- Pada setiap sinkronisasi, device mengirim daftar user yang pernah di-cache beserta `login_id` dan fingerprint password-nya ke server.
- Server membandingkan terhadap data terkini di `sysuser`: perubahan pada `login_id` **atau** `password` dianggap "berubah".
- Bila berubah, device mencabut sesi offline dan kredensial cache user tersebut **di device itu**.
- Pencabutan berlaku untuk **semua user yang ter-cache** di device, bukan hanya user yang sedang login.
- User yang kredensialnya dicabut wajib login online ulang.
- Tidak ada password plaintext yang dikirim dari server ke device; perbandingan dilakukan di sisi server menggunakan fingerprint (lihat catatan BR-19).

---

### F2 — Sinkronisasi Data ke Device (Pull / Download)

#### FR-2.1 — Unduh penuh saat login pertama
**Cerita pengguna:** Sebagai operator gudang, saya ingin semua data yang dibutuhkan otomatis terunduh saat login pertama, sehingga saya bisa bekerja offline.

**Kriteria penerimaan:**
- Setelah login online pertama, aplikasi otomatis mengunduh:
  - Semua PO berstatus `CHECKED` beserta item-nya.
  - Master barang (`pos_item_master`) dengan filter `is_active = 1`.
  - Data satuan (`pos_unit`).
  - Data vendor (`vendor`).
  - Data vendor-item (`pos_vendor_item`) — dibutuhkan untuk konversi satuan.
- Proses unduhan menampilkan **progress** yang jelas.
- Data tersimpan di penyimpanan lokal (IndexedDB/Dexie).

#### FR-2.2 — Unduh ulang manual
**Cerita pengguna:** Sebagai operator gudang, saya ingin ada tombol untuk mengunduh ulang data, sehingga saya bisa memperbarui data master/PO tanpa harus login ulang.

**Kriteria penerimaan:**
- Tersedia tombol "Unduh Ulang Data" di aplikasi (hanya berfungsi saat online).
- Unduh ulang **tidak menghapus** dokumen penerimaan yang belum tersinkron (data pekerjaan tidak boleh hilang).
- Progress unduhan ditampilkan; kegagalan ditampilkan dengan pesan yang jelas.

#### FR-2.3 — Pembaruan daftar PO saat online
**Cerita pengguna:** Sebagai operator gudang, saya ingin daftar PO selalu terbaru saat koneksi tersedia, sehingga saya tahu PO mana yang baru bisa dikerjakan.

**Kriteria penerimaan:**
- Setiap kali aplikasi terhubung internet, daftar PO `CHECKED` disegarkan (pull ulang).
- PO yang sudah `CLOSED` atau statusnya berubah dari `CHECKED` tidak lagi ditampilkan (atau ditandai tidak bisa diproses).
- Penyegaran tidak mengganggu sesi penerimaan yang sedang berjalan.

#### FR-2.4 — Cakupan data
**Cerita pengguna:** Sebagai operator gudang, saya ingin melihat semua PO yang siap dikerjakan, sehingga saya tidak melewatkan pesanan.

**Kriteria penerimaan:**
- Semua PO `CHECKED` ditarik **tanpa filter lokasi** (untuk fase ini).
- Filter per lokasi akan ditambahkan di fase berikutnya (lihat Non-Tujuan).

---

### F3 — Daftar & Detail PO

#### FR-3.1 — Daftar PO
**Cerita pengguna:** Sebagai operator gudang, saya ingin melihat daftar PO yang bisa saya kerjakan, sehingga saya bisa memilih yang akan diproses.

**Kriteria penerimaan:**
- Daftar menampilkan: nomor PO, nama vendor, tanggal PO, dan total nilai (opsional).
- Daftar bisa diakses **offline** (dari data lokal).
- Ada pencarian/filter minimal: berdasarkan nomor PO dan/atau vendor.

#### FR-3.2 — Detail PO
**Cerita pengguna:** Sebagai operator gudang, saya ingin melihat isi PO (daftar barang + jumlah dipesan), sehingga saya tahu apa yang harus diterima.

**Kriteria penerimaan:**
- Detail menampilkan tiap item: kode/barcode, nama barang, satuan, dan **qty dipesan** (`qty` pada `pos_purchase_item`).
- Menampilkan **sisa yang belum diterima** per item (qty dipesan dikurangi total yang sudah diterima berdasarkan data lokal + hasil sinkronisasi terakhir). Angka ini bersifat **perkiraan lokal**; angka resmi dihitung server saat sinkronisasi.
- Menampilkan status kemajuan PO (misal: Belum diterima / Sebagian / Lengkap / Lebih).

#### FR-3.3 — Mulai penerimaan dari PO
**Cerita pengguna:** Sebagai operator gudang, saya ingin memulai penerimaan langsung dari sebuah PO, sehingga data PO otomatis terbawa ke sesi penerimaan.

**Kriteria penerimaan:**
- Dari detail PO, tersedia tombol "Mulai Penerimaan".
- Sesi baru otomatis merujuk ke PO tersebut (vendor, lokasi, tanggal, dsb. mengikuti PO).

---

### F4 — Sesi Penerimaan (Scan & Input)

#### FR-4.1 — Membuat sesi penerimaan
**Cerita pengguna:** Sebagai operator gudang, saya ingin membuat sesi penerimaan untuk satu PO, sehingga hasil scan saya tercatat rapi.

**Kriteria penerimaan:**
- **Satu sesi = satu dokumen `pos_receive`** di sisi data.
- Satu PO boleh punya banyak sesi (dari satu device yang sama maupun device berbeda).
- Sesaat dibuat, sesi berstatus lokal `DRAFT` dan punya **ID sementara lokal** (UUID) — nomor dokumen resmi menyusul setelah sinkronisasi.

#### FR-4.2 — Input nomor Invoice & DO
**Cerita pengguna:** Sebagai operator gudang, saya ingin mencatat nomor invoice dan nomor surat jalan (DO) dari vendor, sehingga dokumen penerimaan lengkap.

**Kriteria penerimaan:**
- Tersedia kolom `invoice_number` dan `do_number` — **keduanya wajib diisi**.
- Validasi wajib isi dilakukan sebelum sesi bisa difinalisasi.
- *(Opsional, nice-to-have):* nomor DO bisa diisi dengan scan barcode bila surat jalan vendor memiliki barcode.

#### FR-4.3 — Scan barcode untuk identifikasi barang
**Cerita pengguna:** Sebagai operator gudang, saya ingin scan barcode barang langsung teridentifikasi, sehingga saya tidak perlu mengetik kode barang.

**Kriteria penerimaan:**
- Scan (mode keystroke dari scanner perangkat) mengisi field yang sedang fokus dan otomatis memproses (Enter).
- Pencocokan barcode dilakukan terhadap `barcode`, `barcode_2`, dan `barcode_3` pada master barang.
- Jika barang tidak ada di PO yang sedang dikerjakan, tampil **peringatan** dan barang tidak bisa ditambahkan ke sesi.
- Jika barcode tidak dikenali, tampil pesan yang jelas.

#### FR-4.4 — Input qty dalam satuan PO
**Cerita pengguna:** Sebagai operator gudang, saya ingin memasukkan jumlah barang dalam satuan yang sama dengan PO, sehingga tidak bingung konversi.

**Kriteria penerimaan:**
- Setelah barang teridentifikasi, operator memasukkan qty **dalam satuan PO** (purchase UOM) langsung.
- qty yang tersimpan pada item penerimaan (`qty`) menggunakan **satuan yang sama dengan `pos_purchase_item.uom_id`**.
- Sistem otomatis mengambil faktor konversi `conv_qty` dari data vendor-item lokal dan menyimpannya pada `qty_purchase` (dengan `conv_unit` = 1). Bila data konversi tidak ditemukan, dipakai faktor 1 dan diberi tanda peringatan.

#### FR-4.5 — Daftar item dalam sesi
**Cerita pengguna:** Sebagai operator gudang, saya ingin melihat daftar barang yang sudah saya scan dalam sesi ini, sehingga saya bisa memastikan tidak ada yang salah.

**Kriteria penerimaan:**
- Menampilkan tiap item: nama/kode barang, qty diterima, dan satuan.
- Item bisa **diedit/dihapus** selama sesi belum difinalisasi.
- Ada indikator jika sebuah item menyebabkan over-receive terhadap sisa yang tercatat.

#### FR-4.6 — Pause & lanjutkan sesi
**Cerita pengguna:** Sebagai operator gudang, saya ingin bisa berhenti sejenak dan melanjutkan sesi yang sama, sehingga pekerjaan tidak hilang.

**Kriteria penerimaan:**
- Sesi yang belum difinalisasi tetap tersimpan lokal.
- Operator bisa menutup/membuka kembali sesi yang belum selesai dan melanjutkannya.
- Data sesi tidak hilang walau aplikasi ditutup paksa.

#### FR-4.7 — Finalisasi sesi
**Cerita pengguna:** Sebagai operator gudang, saya ingin menandai sesi selesai, sehingga dokumen masuk antrian untuk dikirim ke server.

**Kriteria penerimaan:**
- Tombol "Selesai / Finalisasi" tersedia.
- Sebelum finalisasi, sistem memastikan `invoice_number` dan `do_number` terisi.
- Setelah finalisasi, sesi masuk **antrian sinkronisasi (outbox)** dan statusnya menjadi "Menunggu Sinkronisasi".
- Sesi yang sudah difinalisasi **tidak bisa diedit lagi** di device (kecuali dibatalkan sesuai aturan yang berlaku).

#### FR-4.8 — Sesi yang sudah tersinkron bersifat baca-saja
**Cerita pengguna:** Sebagai operator gudang, saya ingin dokumen yang sudah terkirim ke server tidak berubah-ubah di device, sehingga tidak terjadi perbedaan data.

**Kriteria penerimaan:**
- Setelah sinkronisasi sukses, sesi menjadi **read-only** di device.
- Perubahan atas dokumen tersebut dilakukan di website admin.

---

### F5 — Sinkronisasi Data ke Server (Push / Upload)

#### FR-5.1 — Sinkronisasi otomatis & manual
**Cerita pengguna:** Sebagai operator gudang, saya ingin data terkirim otomatis begitu ada koneksi, dan saya juga bisa memicu pengiriman manual, sehingga saya yakin data terkirim.

**Kriteria penerimaan:**
- Saat koneksi internet terdeteksi, aplikasi **otomatis** mengirim sesi-sesi yang menunggu.
- Tersedia juga tombol "Sinkronkan Sekarang" untuk memicu manual.
- Antrian dikirim **berurutan (FIFO)** sesuai urutan finalisasi.

#### FR-5.2 — Pembuatan ID & nomor dokumen resmi di server
**Cerita pengguna:** Sebagai pemilik bisnis, saya ingin nomor dokumen penerimaan resmi dan unik, sehingga tidak ada bentrok dengan dokumen dari website admin.

**Kriteria penerimaan:**
- `receive_id`, `receive_item_id`, `number` (format `IN+MMYY+0001`), `counter`, dan `prefix_number` **dibuat oleh server saat sinkronisasi**, bukan oleh device.
- Skema ID mengikuti skema sistem admin yang sudah ada (struktur waktu + index aplikasi + digit), dengan **index aplikasi khusus untuk aplikasi PDT** agar tidak mungkin bertabrakan dengan ID yang dibuat website admin.
- Device cukup mengirim ID sementara (UUID) sebagai referensi pemetaan.

#### FR-5.3 — Anti-duplikasi (idempotensi)
**Cerita pengguna:** Sebagai pemilik bisnis, saya ingin sinkronisasi yang terputus di tengah jalan tidak menyebabkan data ganda, sehingga laporan tetap akurat.

**Kriteria penerimaan:**
- Jika pengiriman yang sama terulang (misal koneksi putus lalu dicoba lagi), server **tidak membuat dokumen ganda**.
- Server mengenali kiriman ulang berdasarkan ID sementara/ID resmi yang sudah pernah diproses.
- Hasilnya tetap satu dokumen `pos_receive` per sesi.

#### FR-5.4 — Validasi kuantitas di server
**Cerita pengguna:** Sebagai pemilik bisnis, saya ingin validasi jumlah diterima vs dipesan dihitung terpusat, sehingga semua device konsisten.

**Kriteria penerimaan:**
- Saat sinkronisasi, server menghitung total yang sudah diterima untuk tiap item PO **dari semua dokumen** (termasuk dari device lain dan dari website admin).
- Perbandingan dilakukan pada **satuan yang sama** (satuan PO).
- Hasil validasi menentukan apakah item lolos, atau ditandai over-receive (lihat F6).

#### FR-5.5 — Hasil sinkronisasi dikembalikan ke device
**Cerita pengguna:** Sebagai operator gudang, saya ingin melihat nomor dokumen resmi setelah sinkronisasi, sehingga saya bisa mengecek jejak dokumen.

**Kriteria penerimaan:**
- Setelah sukses, server mengembalikan `receive_id` dan `number` resmi ke device.
- Device menyimpan dan menampilkan nomor resmi menggantikan ID sementara.
- Sesi bertanda "Tersinkron".

#### FR-5.6 — Penanganan kegagalan sinkronisasi
**Cerita pengguna:** Sebagai operator gudang, saya ingin tahu bila pengiriman gagal, dan data saya tidak hilang, sehingga saya bisa mencoba lagi.

**Kriteria penerimaan:**
- Bila gagal karena masalah sementara (mis. koneksi), sesi tetap berada di antrian dengan status "Gagal — coba lagi".
- Bila ditolak permanen oleh server (PO ditutup/dihapus, atau item tidak valid), sesi berstatus "Ditolak", keluar dari antrian, tidak dihitung pada angka "Diterima", dan daftar PO disegarkan otomatis.
- Pesan kegagalan ditampilkan dengan alasan yang dapat dipahami.
- Data lokal **tidak pernah dihapus** sebelum server mengonfirmasi sukses.

#### FR-5.7 — Transaksi utuh
**Cerita pengguna:** Sebagai pemilik bisnis, saya ingin dokumen tidak tersimpan setengah-setengah (header ada tapi item tidak), sehingga data selalu utuh.

**Kriteria penerimaan:**
- Penyimpanan header `pos_receive` dan seluruh itemnya dilakukan **dalam satu transaksi** — sukses semua atau gagal semua.

---

### F6 — Over-Receive & Persetujuan

#### FR-6.1 — Aturan over-receive
**Cerita pengguna:** Sebagai pemilik bisnis, saya ingin total barang diterima tidak melebihi pesanan tanpa sepengetahuan saya.

**Kriteria penerimaan:**
- Aturan resmi: **jumlah total `qty` semua item penerimaan untuk satu item PO ≤ `qty` dipesan pada item PO tersebut** (satuan sama = satuan PO).
- Total dihitung **lintas semua dokumen/sesi/device** untuk item PO yang sama.
- Saat ini **tidak ada toleransi**: kelebihan sekecil apa pun dianggap over-receive. (Catatan: toleransi untuk barang timbangan dapat dipertimbangkan di fase berikutnya.)

#### FR-6.2 — Perlakuan saat over-receive
**Cerita pengguna:** Sebagai pemilik bisnis, saya ingin penerimaan yang melebihi pesanan tetap tercatat namun menunggu persetujuan saya, sehingga tidak menggagalkan pekerjaan gudang.

**Kriteria penerimaan:**
- Dokumen **tetap tersimpan sebagai `DRAFT`** (tidak ditolak).
- Item yang over-receive **ditandai** menggunakan kolom catatan yang sudah ada (memo/note) dengan kode konvensi yang disepakati, karena schema database tidak boleh diubah untuk sementara.
- Item yang over-receive **masuk daftar tunggu persetujuan (worklist) di website admin**.

#### FR-6.3 — Informasi ke operator
**Cerita pengguna:** Sebagai operator gudang, saya ingin tahu bila ada item saya yang melebihi pesanan, sehingga saya bisa menjelaskan ke atasan.

**Kriteria penerimaan:**
- Hasil sinkronisasi menampilkan dengan jelas item mana yang over-receive dan berapa kelebihannya.
- Operator diberi tahu bahwa item tersebut **menunggu persetujuan admin**.
- Item yang tidak over-receive tetap berjalan normal.

#### FR-6.4 — Keputusan admin
**Cerita pengguna:** Sebagai admin, saya ingin menyetujui atau menolak over-receive, sehingga data akhir sesuai keputusan bisnis.

**Kriteria penerimaan:**
- Admin dapat melihat daftar item over-receive beserta konteksnya (PO, vendor, qty dipesan, qty diterima).
- Admin dapat **menyetujui** (diterima apa adanya) atau **menolak/menyesuaikan**.
- Proses persetujuan dilakukan **di website admin** (di luar aplikasi PDT), sesuai pembagian kerja yang disepakati.

---

### F7 — Indikator Status & Sinkronisasi

#### FR-7.1 — Indikator koneksi
**Cerita pengguna:** Sebagai operator gudang, saya ingin selalu tahu apakah aplikasi sedang online atau offline, sehingga saya paham status data saya.

**Kriteria penerimaan:**
- Ada indikator jelas "Online" / "Offline" yang selalu terlihat.
- Perubahan status langsung tercermin tanpa perlu refresh.

#### FR-7.2 — Indikator antrian sinkronisasi
**Cerita pengguna:** Sebagai operator gudang, saya ingin tahu berapa dokumen yang belum terkirim, sehingga tidak ada yang tertinggal.

**Kriteria penerimaan:**
- Ada indikator jumlah sesi yang "Menunggu Sinkronisasi".
- Setelah semua terkirim, indikator menunjukkan kosong/aman.

#### FR-7.3 — Status tiap sesi
**Cerita pengguna:** Sebagai operator gudang, saya ingin melihat status tiap sesi penerimaan saya, sehingga mudah memantau.

**Kriteria penerimaan:**
- Tiap sesi menampilkan salah satu status: **Berjalan** (belum final), **Menunggu Sinkronisasi**, **Sedang Dikirim**, **Tersinkron**, **Gagal** (sementara, bisa dicoba ulang), atau **Ditolak** (ditolak permanen oleh server, mis. PO ditutup — bisa dihapus).
- Sesi yang sudah tersinkron menampilkan nomor dokumen resmi.

---

### F8 — Manajemen Data Lokal

#### FR-8.1 — Unduh ulang data master & PO
**Cerita pengguna:** Sebagai operator gudang, saya ingin memperbarui data master dan PO secara manual, sehingga data saya akurat.

**Kriteria penerimaan:**
- Tombol "Unduh Ulang Data" tersedia dan hanya aktif saat online.
- Mengunduh ulang data master dan PO terbaru **tanpa menghapus dokumen penerimaan yang belum tersinkron**.

#### FR-8.2 — Kapasitas penyimpanan
**Cerita pengguna:** Sebagai tim IT, saya ingin penyimpanan device tidak penuh, sehingga aplikasi tetap lancar.

**Kriteria penerimaan:**
- Aplikasi menampilkan perkiraan pemakaian penyimpanan lokal (opsional).
- Data sesi yang sudah tersinkron dapat dibersihkan dari device (dengan konfirmasi), sedangkan data master tetap dipertahankan.

#### FR-8.3 — Layar diagnostik & ekspor log
**Cerita pengguna:** Sebagai tim IT, saya ingin melihat riwayat teknis sebuah device dan menerima salinannya, sehingga saya bisa menjawab "kenapa dokumen ini tidak muncul di admin?" tanpa menebak.

**Kriteria penerimaan:**
- Tersedia layar diagnostik yang dapat dibuka dari Pengaturan (bagian **Info**), berisi: jumlah sesi per status, waktu kirim terakhir, waktu unduh terakhir, penanda daftar PO perlu disegarkan, dan daftar log terbaru.
- Log mencatat kejadian **jaringan** (sinkronisasi & unduh data) dan **teknis** (error aplikasi, versi baru PWA siap). Jejak login/kredensial dan jejak aksi operator (scan, qty) **tidak** dicatat.
- Daftar log diurutkan terbaru lebih dulu dan dapat disaring menjadi hanya entri `warn` & `error`.
- Log dapat diekspor menjadi **satu berkas CSV** yang berisi potret perangkat, daftar sesi, dan isi log; berkas dibuat **sepenuhnya di device** dan tidak dikirim ke server mana pun.
- Jika perangkat tidak mendukung unduhan berkas, aplikasi menyalin ringkasan ke clipboard dan mengatakannya kepada operator — bukan gagal tanpa pesan.
- Log dibatasi **2000 entri terbaru** agar tidak memenuhi penyimpanan device, bertahan setelah logout, dan dapat dihapus manual dengan konfirmasi.
- Isi log tidak memuat barcode barang.

---

## 10. Aturan Bisnis (Business Rules)

Kolom **Implementasi** adalah arah penelusuran dari dokumen ke kode. Arah sebaliknya tidak ada:
komentar di kode tidak menyebut ID aturan, melainkan menjelaskan aturannya sendiri — lihat
"Code comments" di `CLAUDE.md`.

| ID | Aturan | Implementasi |
| --- | --- | --- |
| BR-1 | Hanya PO berstatus `CHECKED` yang ditarik ke device dan boleh diproses penerimaannya. | `src/core/contracts/constants.ts` (`PULLABLE_PURCHASE_STATUS`), `src/server/services/pull-service.ts`, `src/server/services/sync-service.ts` (cek ulang saat push) |
| BR-2 | Aplikasi PDT hanya membuat dokumen penerimaan berstatus `DRAFT`. Proses `APPROVED` dan `CHECKED` dilakukan di website admin. | `src/core/contracts/constants.ts` (`RECEIVE_STATUS_DRAFT`), `src/server/services/sync-service.ts` |
| BR-3 | **Satu sesi scan per device = satu dokumen `pos_receive`.** Satu PO boleh memiliki banyak dokumen penerimaan. | `src/server/services/sync-service.ts` (`processSession`) |
| BR-4 | **Satu PO boleh dikerjakan oleh banyak PDT secara bersamaan.** Perbandingan kuantitas dihitung terpusat (agregat) di server saat sinkronisasi. | `src/server/services/sync-service.ts`, `src/server/services/pull-service.ts` (`getReceivedAggregate`), `src/features/receiving/logic/session-owner.ts` |
| BR-5 | Over-receive (total diterima > dipesan) **tidak ditolak**, tetapi ditandai dan menunggu persetujuan admin. Saat ini **tanpa toleransi**. | `src/core/receiving/over-receive.ts`, `src/core/receiving/memo.ts`, `src/features/receiving/cockpit/item-picker.tsx` (peringatan sebelum tulis) |
| BR-6 | Perbandingan over-receive: `jumlah total qty semua item penerimaan untuk satu item PO ≤ qty dipesan` — keduanya dalam **satuan yang sama (satuan PO)**. | `src/core/receiving/over-receive.ts` (`evaluateSession`) |
| BR-7 | Operator menginput qty **langsung dalam satuan PO**. Faktor konversi `conv_qty` dari `pos_vendor_item` disimpan sebagai `qty_purchase` (dengan `conv_unit` = 1). Bila data konversi tidak ada, dipakai faktor 1. | `src/core/receiving/uom.ts`, `src/features/receiving/scanning.ts` (`resolveWithConversion`) |
| BR-8 | `receive_id`, `receive_item_id`, `number`, `counter`, dan `prefix_number` dibuat **di server saat sinkronisasi**. Device memakai ID sementara (UUID) sebelum sinkronisasi. | `src/core/identity/doc-number.ts`, `src/core/identity/ids.ts`, `src/server/services/sync-service.ts` (lock penomoran) |
| BR-9 | `invoice_number` dan `do_number` **wajib diisi** di device sebelum sesi difinalisasi. | `src/features/receiving/session/vendor-doc-card.tsx`, `src/features/receiving/review/session-review.tsx` |
| BR-10 | Login offline maksimal **7 hari** sejak login online terakhir; setelah itu wajib login online. | `src/features/auth/offline-auth.ts`, `src/server/env.ts` (`sessionTtlDays`) |
| BR-11 | User **boleh login dari device mana pun**; tidak ada penguncian akun ke device. | `src/data/local-db.ts` (`LocalCredential`, kunci per device+user), `src/data/local-repo.ts` |
| BR-12 | Seluruh kolom `bigint` ditangani sebagai **string/BigInt**, bukan number JavaScript, untuk mencegah hilangnya presisi (ID berukuran lebih dari 2^53). | `src/core/identity/ids.ts`, `src/core/contracts/schemas.ts` (`bigintString`), `src/server/db/client.ts` (`bigNumberStrings`), `src/server/db/schema.ts` |
| BR-13 | Untuk fase ini, semua PO `CHECKED` ditarik **tanpa filter lokasi**. Filter per lokasi menyusul. | `src/server/services/pull-service.ts`, `src/server/functions/data.ts` |
| BR-14 | Barang yang di-scan harus merupakan bagian dari PO yang sedang dikerjakan. Barang di luar PO ditolak dengan peringatan. | `src/features/receiving/scanning.ts` (`resolveScan`), `src/server/services/sync-service.ts` (langkah 3) |
| BR-15 | Sesi yang sudah tersinkron menjadi **read-only** di device. | `src/data/local-repo.ts` (`markSynced`), `src/features/receiving/logic/session-owner.ts` (`canEditSession`) |
| BR-16 | Data master & PO diunduh **penuh** saat login pertama + tombol unduh ulang manual. Tidak menggunakan sinkronisasi inkremental berbasis kolom `last_update`. | `src/features/sync/engine.ts` (`pullAllData`), `src/core/contracts/constants.ts` (`MASTER_DATA_STALE_HOURS`) |
| BR-17 | Skema ID sistem admin tetap dihormati: aplikasi PDT menggunakan **index aplikasi (appIdx) tersendiri** yang direservasi khusus agar ID tidak bertabrakan dengan ID buatan website admin. | `src/core/identity/ids.ts`, `src/server/env.ts` (`assertDistinctAppIdx`) |
| BR-18 | Aplikasi **tidak mengubah schema database admin**; hanya membaca dan menulis tabel yang sudah ada. | `src/server/db/schema.ts` (mirror DDL, tanpa migrasi), `src/core/receiving/memo.ts` (state menumpang kolom teks) |
| BR-19 | Perubahan `login_id` atau `password` pada `sysuser` wajib dicabut dari semua device pada **kesempatan sinkronisasi berikutnya**. Deteksi dilakukan dengan membandingkan `login_id` dan fingerprint password (HMAC dengan kunci rahasia di server, bukan password plaintext) di sisi server; pencabutan berlaku untuk **semua user yang ter-cache** di tiap device. Aturan ini melengkapi BR-10: BR-10 = batas maksimum offline, BR-19 = pencabutan lebih cepat begitu device online. | `src/server/crypto/credentials.ts`, `src/server/services/auth-service.ts` (`checkCredentialRevocations`), `src/data/local-repo.ts` (`removeCredentialsForUsers`) |

---

## 11. Kebutuhan Non-Fungsional (NFR)

| ID | Kategori | Kebutuhan |
| --- | --- | --- |
| NF-1 | Ketersediaan (Offline) | Semua fungsi inti — login offline, lihat PO, scan, input, simpan — berjalan penuh tanpa internet. |
| NF-2 | Kompatibilitas | Berjalan baik di perangkat PDT berbasis Android apa pun melalui browser/WebView modern. *(Konfirmasi tipe perangkat serta versi Android/browser masih pending — lihat Asumsi.)* |
| NF-3 | Kompatibilitas DB | Mendukung MySQL versi 5.x (database existing). |
| NF-4 | Performa | Dengan ±50.000 master barang di penyimpanan lokal: pencarian barcode/kode responsif (target < 300 ms), daftar PO tetap lancar, unduh awal berjalan chunking dengan indikator progress. |
| NF-5 | Keamanan | Password **tidak disimpan sebagai teks biasa** di device (hash + salt lokal); sesi kedaluwarsa 7 hari; koneksi ke server menggunakan protokol aman. |
| NF-6 | Keandalan Sync | Sinkronisasi idempoten (tidak menghasilkan duplikat), tahan putus koneksi di tengah proses, dan tidak pernah menghapus data lokal sebelum konfirmasi sukses dari server. |
| NF-7 | Integritas ID | Tidak ada tabrakan ID antar penulis (device PDT vs website admin) — dijamin oleh reservasi appIdx terpisah. |
| NF-8 | Usability | UI keypad-first: font besar, tombol besar, kontras baik, navigasi keyboard, field scan selalu siap (auto-focus), minim ketikan manual. |
| NF-9 | Kemudahan pemulihan | Aplikasi dapat pulih setelah paksa ditutup (data sesi berjalan tidak hilang). |
| NF-10 | Operasional | Aplikasi terpasang sebagai PWA dan dapat di-lockdown (kiosk) di device; konfigurasi scanner perangkat terdokumentasi untuk tim IT. |

---

## 12. Data & Pemetaan Skema (Ringkasan)

Aplikasi membaca/menulis tabel-tabel yang sudah ada di database admin. Ringkasan per tabel:

### 12.1 `pos_purchase` — PO (dibaca saja)

| Kolom Penting | Keterangan |
| --- | --- |
| `purchase_id` | ID PO (bigint → diperlakukan sebagai string/BigInt). |
| `number` | Nomor PO untuk tampilan (contoh: `PO09260001`). |
| `status` | Hanya `CHECKED` yang ditarik. |
| `vendor_id`, `location_id`, `user_id` | Referensi vendor/lokasi/pembuat. |
| `total_amount`, `total_tax`, dst. | Nilai dokumen (tampilan saja). |

### 12.2 `pos_purchase_item` — Item PO (dibaca saja)

| Kolom Penting | Keterangan |
| --- | --- |
| `purchase_item_id` | ID item PO. |
| `item_master_id` | Referensi master barang. |
| `qty` | **Qty dipesan — satuan sama dengan `uom_id` (satuan PO).** Menjadi **basis perbandingan over-receive**. |
| `uom_id` | Satuan yang dipakai PO. |
| `qty_order`, `qty_purchase`, `uom_purchase_id` | **Saat ini tidak dipakai** (diabaikan). |

### 12.3 `pos_receive` — Dokumen Penerimaan (ditulis saat sinkronisasi)

| Kolom Penting | Keterangan |
| --- | --- |
| `receive_id` | **Dibuat server saat sync** (skema ID sistem admin, appIdx khusus PDT). |
| `number`, `counter`, `prefix_number` | Nomor resmi `IN+MMYY+0001` — **dibuat server saat sync**. |
| `status` | Selalu `DRAFT` dari aplikasi PDT. |
| `purchase_id` | PO yang dirujuk. |
| `vendor_id`, `location_id`, `user_id` | Mengikuti PO / user yang login. |
| `invoice_number`, `do_number` | **Wajib**, diinput manual di device. |
| `date`, `due_date` | Tanggal penerimaan & jatuh tempo. |
| `approval_1`, `approval_2`, `approval_3` | Selalu `0` (belum ada persetujuan; tanpa alter database). |
| `include_tax`, `tax_percent`, `payment_type`, `currency_id`, `price_include_tax`, `discount_percent` | Disalin dari PO (`pos_purchase`). |
| `total_amount`, `discount_total`, `total_tax` | Dihitung ulang saat sinkronisasi dari item penerimaan — lihat **12.11 Rumus Finansial**. |
| `type` | Selalu `1`. |
| `company_id` | **NULL** (sengaja tidak ditulis). |

### 12.4 `pos_receive_item` — Item Penerimaan (ditulis saat sinkronisasi)

| Kolom Penting | Keterangan |
| --- | --- |
| `receive_item_id` | **Dibuat server saat sync.** |
| `receive_id` | Referensi ke dokumen penerimaan. |
| `purchase_item_id` | Referensi ke item PO (untuk agregasi per item PO). |
| `item_master_id` | Referensi master barang. |
| `qty` | **Qty diterima dalam satuan PO** (sama dengan `pos_purchase_item.uom_id`). Dipakai untuk perbandingan over-receive. |
| `uom_id` | Satuan stok terkecil (dari `pos_item_master.uom_stock_id`). |
| `uom_purchase_id` | Menyimpan `pos_purchase_item.uom_id` — penanda bahwa satuan PO berbeda dari satuan stok terkecil. |
| `qty_purchase` | Faktor konversi `conv_qty` dari `pos_vendor_item` (bukan hasil kali `qty`). Dipakai untuk pembukuan stok. |
| `conv_unit` | Selalu `1` (pembilang rasio "1 satuan PO = `conv_qty` satuan stok"). |
| `amount`, `total_amount`, `discount_amount` | Dihitung ulang: harga satuan PO, subtotal, dan diskon diprorata — lihat **12.11**. |
| `delivery_date`, `expired_date` | Tanggal penerimaan (datetime) dan tanggalnya (date). |
| `status` | **NULL** (sengaja tidak ditulis). |
| `is_bonus`, `price_import`, `transport`, `bea`, `komisi`, `lain_lain`, `dis_1..4_*`, `ap_coa_id`, `type`, `segment1_id`, `expired_check_*` | Diisi `0` / `0.00`. |

> **Penting (semantik UOM):** `qty` dan `qty_purchase` bukan duplikat. `qty` = jumlah diterima dalam satuan PO (dipakai validasi vs pesanan). `conv_unit` dan `qty_purchase` menyimpan RASIO konversi dari `pos_vendor_item`: `conv_unit = 1` (selalu) dan `qty_purchase = conv_qty` (faktor konversi). Contoh: PO memakai karton (purchase UOM); 1 karton = 12 pcs (stock UOM); maka untuk item tersebut `qty_purchase = 12` dan `conv_unit = 1`, terlepas dari berapa pun `qty` yang diterima.

### 12.5 `pos_item_master` — Master Barang (dibaca saja)

| Kolom Penting | Keterangan |
| --- | --- |
| `item_master_id` | ID barang. |
| `code`, `barcode`, `barcode_2`, `barcode_3` | Dipakai untuk identifikasi hasil scan. |
| `name` | Nama barang (tampilan). |
| `uom_stock_id`, `uom_purchase_id` | Satuan stok & satuan beli. |
| `is_active` | Filter unduhan: hanya `1` yang diunduh. |

### 12.6 `vendor` (dibaca saja)

Dipakai untuk nama vendor pada tampilan PO/penerimaan.

### 12.7 `pos_vendor_item` (dibaca saja)

| Kolom Penting | Keterangan |
| --- | --- |
| `vendor_id`, `item_master_id`, `uom_purchase` | Kunci pencocokan konversi. |
| `conv_qty` | Faktor konversi satuan PO → satuan stok. **Wajib tersedia offline** untuk mengisi `qty_purchase` (dan `conv_unit` = 1). |

### 12.8 `pos_unit` (dibaca saja)

Kamus satuan (`uom_id` → nama satuan).

### 12.9 `sysuser` (dibaca saja — untuk login)

| Kolom Penting | Keterangan |
| --- | --- |
| `login_id`, `password` | Kredensial login. *Catatan: password tersimpan plain text di sistem legacy — lihat Risiko.* |
| `full_name`, `company_id` | Identitas & perusahaan user. |

### 12.10 Penyimpanan lokal di device (Dexie/IndexedDB)

| Entitas Lokal | Isi |
| --- | --- |
| Data master & PO | Salinan lokal dari tabel-tabel di atas. |
| Sesi penerimaan | Dokumen `DRAFT` lokal dengan **UUID sementara**, belum punya `receive_id`/`number` resmi. |
| Outbox | Antrian sesi yang menunggu dikirim ke server + status pengiriman. |
| Kredensial offline | Per (device, user): hash password dengan salt lokal + fingerprint password (untuk deteksi perubahan, lihat BR-19) + waktu kedaluwarsa (7 hari). |

### 12.11 Rumus Finansial Dokumen Penerimaan

Dihitung **di server saat sinkronisasi** dari data PO (`pos_purchase` & `pos_purchase_item`).
Semua hasil dibulatkan **2 desimal (round half-up)**.

**Per baris item (`pos_receive_item`):**

- `amount` = `pos_purchase_item.amount` (harga satuan dalam satuan PO).
- `discount_amount` = `pos_purchase_item.discount_amount × qty_diterima ÷ qty_dipesan` (diskon diprorata).
- `total_amount` = `qty_diterima × amount − discount_amount`.

**Header dokumen (`pos_receive`):**

- `total_amount` = jumlah seluruh `total_amount` item.
- `discount_total` = `total_amount × discount_percent ÷ 100` (`discount_percent` disalin dari PO).
- `total_tax`:
  - `price_include_tax = 0` → `(total_amount − discount_total) × tax_percent ÷ 100`
  - `price_include_tax = 1` → `(total_amount − discount_total) × tax_percent ÷ (100 + tax_percent)`

> Diskon berjenjang `dis_1..dis_4` pada item PO **tidak direplikasi**; yang dipakai hanya hasil
> akhir `discount_amount` PO yang kemudian diprorata terhadap qty diterima.

### 12.12 `document_history` (ditulis saat sinkronisasi sukses)

Saat dokumen penerimaan berhasil dibuat, aplikasi menulis satu baris riwayat agar terlihat
di sistem admin:

| Kolom | Nilai |
| --- | --- |
| `document_history_id` | ID namespace PDT (appIdx 2), dibuat server. |
| `type` | `2` (incoming). |
| `user_id` | User pembuat sesi. |
| `employee_id` | `0`. |
| `description` | `New incoming document <nomor> created from PDT device <deviceId>.` |
| `ref_id` | `receive_id` dokumen yang dibuat. |
| `date` | Waktu server saat sinkronisasi. |

Baris riwayat ikut dibatalkan (rollback) bila transaksi gagal, dan tidak diduplikasi pada
pengiriman ulang (idempoten).

---

## 13. Skenario Contoh

### Skenario A — Penerimaan normal (offline)
1. Pagi hari, device online. Operator login (sudah pernah login sebelumnya, masih dalam 7 hari) — berhasil secara offline sekalipun.
2. Operator membuka daftar PO dan memilih `PO09260001` (vendor A).
3. Koneksi terputus. Operator tetap mulai sesi penerimaan.
4. Operator scan barcode barang → teridentifikasi; input qty = 10 (satuan PO); input nomor invoice & DO.
5. Operator finalisasi sesi. Sesi berstatus "Menunggu Sinkronisasi" dengan ID sementara.
6. Sore hari device online → sinkronisasi otomatis berjalan.
7. Server membuat `receive_id` & nomor `IN09260001`, memvalidasi qty (lolos), menyimpan header + item dalam satu transaksi.
8. Device menerima nomor resmi; sesi berubah menjadi "Tersinkron" dan read-only.

### Skenario B — Over-receive lintas device
1. Device 1 dan Device 2 sama-sama mengerjakan `PO09260001` (item X dipesan 10).
2. Device 1 menerima 6 dan berhasil sinkron.
3. Device 2 (masih offline) menerima 5 → saat sinkron, server menghitung total = 11 > 10 → item ditandai over-receive.
4. Dokumen tetap tersimpan sebagai `DRAFT`; item X masuk worklist admin.
5. Device 2 melihat pesan: "Item X melebihi pesanan sebesar 1 — menunggu persetujuan".
6. Admin menyetujui/menolak dari website admin.

### Skenario C — Sinkronisasi terputus di tengah
1. Sesi dikirim; koneksi putus setelah header tersimpan tapi sebelum konfirmasi diterima device.
2. Device menandai sesi "Gagal — coba lagi".
3. Saat online kembali, device mengirim ulang sesi yang sama.
4. Server mengenali kiriman ulang (idempoten) → tidak membuat dokumen ganda; hanya mengembalikan konfirmasi sukses + nomor resmi.

---

## 14. Asumsi & Pertanyaan Terbuka

| # | Item | Status |
| --- | --- | --- |
| 1 | Tipe perangkat PDT yang dipakai, versi Android/browser (termasuk WebView) yang tersedia. | **Perlu konfirmasi client/vendor device** (memengaruhi fitur PWA/service worker). |
| 2 | Sistem admin production berjalan **satu instance Java** dengan `APP_ID_INDEX = 1`; aplikasi PDT direservasi `appIdx = 2`. | **Diasumsikan benar** — perlu didokumentasikan resmi oleh tim admin. |
| 3 | Barang yang di-scan tapi bukan bagian dari PO **ditolak** (tidak boleh menambah barang bebas di luar PO). | **Perlu konfirmasi client.** |
| 4 | Toleransi over-receive untuk barang timbangan (`weighing_item`) belum ada; dapat diusulkan di fase berikutnya. | Keputusan disengaja untuk fase ini. |
| 5 | Filter per lokasi belum dibuat; semua PO `CHECKED` ditarik. | Keputusan disengaja untuk fase ini. |
| 6 | Konvensi penandaan over-receive memakai kolom `memo`/`note` (karena schema tidak boleh diubah sementara). | **Perlu disepakati format konvensinya dengan tim admin.** |
| 7 | Password di `sysuser` masih plain text (legacy). Aplikasi tidak mengubah sistem admin; mitigasi keamanan di sisi device saja (hash lokal + 7 hari). | **Risiko diterima, perlu persetujuan client.** |

---

## 15. Risiko Utama

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| Device/browser PDT tidak mendukung PWA/service worker (jika ternyata WebView lawas). | Arsitektur offline berubah drastis. | Konfirmasi model & versi browser **sebelum development**; desain lapisan data agar mudah dipindah (NF-2). |
| Tabrakan ID dengan website admin (keduanya menulis `pos_receive`). | Data gagal tersimpan / ID bentrok. | Reservasi `appIdx` terpisah untuk PDT + generasi ID terpusat di server saat sync (BR-17). |
| Presisi bigint hilang di JavaScript. | ID korup, data salah. | Semua bigint sebagai string/BigInt (BR-12). |
| Duplikasi data akibat sinkronisasi terulang. | Stok & laporan ganda. | Idempotensi server (FR-5.3). |
| Over-receive lolos tanpa kontrol. | Selisih stok/tagihan. | Validasi agregat di server + worklist admin (F6). |
| Password plain text (legacy) tersimpan pula di device. | Kebocoran kredensial bila device hilang. | Hash + salt lokal, tanpa plain text; kedaluwarsa 7 hari (FR-1.x). |
| Volume data master (±50 rb) memperlambat unduh awal. | Login pertama lama. | Chunking + progress + tombol unduh ulang (FR-2.x, NF-4). |

---

## 16. Kriteria Penerimaan (Acceptance Criteria) — Ringkasan Tingkat Tinggi

Produk dianggap selesai bila semua terpenuhi:

1. Operator dapat login, melihat PO, scan barang, input qty, dan finalisasi sesi **sepenuhnya tanpa internet**.
2. Setelah online, seluruh sesi tersinkron **tanpa duplikasi** dan nomor dokumen resmi tampil di device.
3. Dua device yang mengerjakan PO yang sama menghasilkan **satu angka sisa yang benar** di server; kelebihan terdeteksi sebagai over-receive dan menunggu approval admin.
4. **Tidak ada tabrakan ID** antara dokumen buatan PDT dan buatan website admin, dibuktikan dengan pengujian sinkronisasi masal.
5. Sinkronisasi yang terputus di tengah dapat **diulang dengan aman** tanpa data ganda dan tanpa kehilangan data.
6. Login offline dibatasi maksimal **7 hari**; setelahnya wajib online.
7. Semua fungsi inti dapat dioperasikan dengan **keypad/layar kecil** perangkat PDT tanpa kesulitan berarti.
8. Tidak ada perubahan schema database admin selama pengembangan.

---

## 17. Riwayat Perubahan

| Versi | Tanggal | Perubahan |
| --- | --- | --- |
| 1.0 | 26 September 2026 | Versi awal — mencakup seluruh keputusan desain hasil diskusi (multi-device, over-receive + approval, generasi ID/nomor di server, login offline 7 hari, pemetaan skema & UOM). |
| 1.1 | 26 September 2026 | Menambahkan FR-1.6 & BR-19: pencabutan kredensial otomatis saat `login_id`/`password` berubah di `sysuser` (deteksi sisi server via fingerprint, berlaku untuk semua user ter-cache, pada sinkronisasi berikutnya). |
| 1.2 | 26 September 2026 | Menetralkan sebutan perangkat target (dari model spesifik menjadi "perangkat PDT") dan menghapus referensi alat scanner vendor-specific, agar aplikasi tidak terikat pada satu model perangkat. |
| 1.3 | 7 Oktober 2026 | Menambahkan FR-8.3: layar diagnostik + ekspor CSV lokal, dengan ring buffer 2000 entri. Cakupan log dibatasi pada kejadian jaringan dan teknis; jejak kredensial dan aksi operator sengaja tidak dicatat, dan barcode tidak pernah masuk ke log. |


---

## 18. Peta Implementasi (FR & NF → kode)

Penelusuran dari kebutuhan ke kode, pada tingkat kelompok. Arahnya satu: komentar di kode
**tidak** menyebut ID — komentar menjelaskan aturannya sendiri beserta akibat bila diubah.
Konvensinya ada di `CLAUDE.md`, bagian "What this is".

| Kebutuhan | Implementasi utama |
| --- | --- |
| FR-1.x — Autentikasi (login online/offline, batas 7 hari, logout, pencabutan) | `src/server/services/auth-service.ts`, `src/server/crypto/credentials.ts`, `src/features/auth/offline-auth.ts`, `src/app/store/auth-slice.ts`, `src/features/auth/login-form.tsx` |
| FR-2.x — Unduh & segarkan data (penuh, chunking, daftar PO) | `src/server/services/pull-service.ts`, `src/features/sync/engine.ts` (`pullAllData`, `refreshPurchases`), `src/data/local-repo.ts` (`replaceMasterData`, `replacePurchases`) |
| FR-3.x — Daftar PO, detail, mulai penerimaan | `src/features/purchase-orders/po-list.tsx`, `src/features/purchase-orders/po-detail.tsx`, `src/data/local-repo.ts` (`getPurchaseProgress`), `src/core/receiving/over-receive.ts` (`progressOf`) |
| FR-4.x — Sesi penerimaan: scan, qty, jeda, finalisasi | `src/features/receiving/scanning.ts`, `src/data/local-repo.ts`, `src/features/receiving/cockpit/session-cockpit.tsx`, `src/features/receiving/cockpit/item-picker.tsx`, `src/features/receiving/session/vendor-doc-card.tsx` |
| FR-5.x — Sinkronisasi (FIFO, idempotensi, penomoran, kegagalan, transaksi) | `src/features/sync/engine.ts` (`syncOutbox`), `src/server/services/sync-service.ts`, `src/core/receiving/memo.ts`, `src/core/identity/doc-number.ts`, `src/core/identity/ids.ts` |
| FR-6.x — Over-receive: hitung, tandai, tampilkan, worklist admin | `src/core/receiving/over-receive.ts`, `src/core/receiving/memo.ts`, `src/server/services/sync-service.ts` (`overReceiveWorklist`), `src/features/receiving/over-receive/over-receive-worklist.tsx` |
| FR-7.x — Indikator koneksi, antrian, status sesi | `src/features/sync/sync-status.tsx`, `src/features/receiving/session/session-status-row.tsx`, `src/features/sync/engine.ts` (`countPendingSessions`), `src/core/contracts/constants.ts` (`SESSION_STATUS`) |
| FR-8.x — Pemeliharaan: unduh ulang, kapasitas penyimpanan, diagnostik & ekspor log | `src/features/settings/settings-screen.tsx`, `src/features/diagnostics/diagnostics-screen.tsx`, `src/data/local-repo.ts` (`deleteSyncedSessions`, `logEvent`, `pruneSyncLog`), `src/features/diagnostics/` (`events`, `trail`, `error-trap`, `read`, `csv`, `download`) |
| NF-1, NF-9 — Offline penuh & pulih setelah aplikasi ditutup | `public/sw.js`, `src/data/local-db.ts`, `src/data/local-repo.ts` (sesi tersimpan sejak scan pertama) |
| NF-4 — Performa dengan ±50 rb master barang | `src/core/contracts/constants.ts` (`DEFAULT_PULL_CHUNK_SIZE`), `src/features/sync/engine.ts` (chunking + progress), indeks Dexie di `src/data/local-db.ts` |
| NF-5 — Keamanan kredensial di device | `src/features/auth/offline-auth.ts` (PBKDF2 + salt), `src/server/crypto/credentials.ts` (HMAC fingerprint), `src/platform/secure-context.ts` |
| NF-7 — Integritas ID antar penulis | `src/core/identity/ids.ts`, `src/server/env.ts` (`assertDistinctAppIdx`) |
| NF-8 — Keypad-first (font & tombol besar, kontras, navigasi keyboard) | `src/styles/app.css`, `src/features/receiving/cockpit/scan-bar.tsx`, `src/ui/numeric-pad.tsx`, `src/platform/scan-focus.ts`, `src/platform/theme.ts` |
| NF-10 — PWA & operasional | `public/sw.js`, `src/app/pwa.ts`, `src/app/update-banner.tsx`, `scripts/stamp-sw.mjs`, `docs/pdt-keymap.md` |
