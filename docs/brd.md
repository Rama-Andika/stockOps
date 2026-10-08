# BRD — Business Requirements Document
## Sistem Pencatatan Penerimaan Barang Berbasis Purchase Order (Offline-First)

## Informasi Dokumen

| Item | Keterangan |
| --- | --- |
| Nama Dokumen | Business Requirements Document (BRD) |
| Nama Proyek | Sistem Pencatatan Penerimaan Barang Berbasis Purchase Order (Offline-First) |
| Versi | 1.1 |
| Tanggal | 26 September 2026 |
| Status | Draft untuk persetujuan |
| Pemrakarsa | Manajemen (pemilik bisnis) |
| Dokumen Terkait | docs/prd.md (rincian kebutuhan produk) |

---

## 1. Ringkasan Eksekutif

Perusahaan saat ini mencatat penerimaan barang dari vendor menggunakan website administrasi yang **wajib terhubung internet**. Padahal aktivitas penerimaan dilakukan di area gudang yang sering kali **tidak memiliki koneksi internet yang stabil**, sehingga proses menjadi lambat dan rawan tertunda.

Proyek ini membangun **aplikasi pencatatan penerimaan barang** yang dipasang di perangkat genggam (PDT) untuk petugas gudang, dengan karakter utama **dapat digunakan sepenuhnya tanpa internet**. Ketika koneksi tersedia, data secara otomatis dikirim ke sistem administrasi yang sudah ada — tanpa mengubah sistem tersebut.

Nilai bisnis utama dari proyek ini:

1. **Pekerjaan gudang tidak lagi bergantung pada internet** — penerimaan tetap berjalan lancar apa pun kondisi jaringan.
2. **Pencatatan lebih cepat dan akurat** — barang diidentifikasi dengan scan barcode, bukan ketikan manual.
3. **Tidak ada entri ganda** — hasil penerimaan langsung masuk ke sistem pusat secara otomatis, menggantikan pencatatan ulang.
4. **Kendali jumlah tetap terjaga** — penerimaan yang melebihi pesanan tidak lolos diam-diam, melainkan ditandai dan menunggu persetujuan.
5. **Data selalu utuh** — pencatatan yang dilakukan beberapa petugas sekaligus pada satu pesanan tetap terhitung benar.

---

## 2. Latar Belakang & Pernyataan Masalah

### 2.1 Latar Belakang

- Proses penerimaan barang berawal dari **Purchase Order (PO)** yang dibuat dan disetujui melalui sistem administrasi yang sudah berjalan.
- Saat ini, pencatatan barang yang datang dilakukan melalui **website administrasi yang membutuhkan koneksi internet**.
- Area penerimaan barang berada di gudang, di mana **koneksi internet sering tidak tersedia atau tidak stabil**.

### 2.2 Pernyataan Masalah

| # | Masalah | Dampak Bisnis |
| --- | --- | --- |
| M-1 | Pencatatan penerimaan terhenti ketika internet putus. | Barang menumpuk, dokumen terlambat, petugas menunggu. |
| M-2 | Hasil penerimaan sering dicatat manual terlebih dahulu (kertas/catatan sementara), lalu diinput ulang ke sistem saat online. | Waktu ganda, risiko salah input, risiko dokumen hilang. |
| M-3 | Identifikasi barang dilakukan dengan mengetik kode secara manual. | Lambat dan rawan salah barang. |
| M-4 | Tidak ada kendali otomatis bila barang diterima melebihi pesanan. | Selisih stok dan tagihan baru diketahui belakangan. |
| M-5 | Ketika satu PO dikerjakan beberapa petugas bersamaan, sulit memastikan total yang diterima tidak melebihi pesanan. | Kendali jumlah tidak terpusat. |

---

## 3. Tujuan Bisnis

| ID | Tujuan | Ukuran Keberhasilan (ringkas) |
| --- | --- | --- |
| T-1 | Proses penerimaan tetap berjalan tanpa internet. | Petugas dapat menyelesaikan penerimaan penuh dalam kondisi offline. |
| T-2 | Mempercepat proses penerimaan barang. | Waktu pencatatan per PO menurun (lihat KPI, bagian 9). |
| T-3 | Meningkatkan akurasi data penerimaan. | Kesalahan identifikasi barang mendekati nol berkat scan barcode. |
| T-4 | Menghilangkan pekerjaan input ulang. | Data penerimaan langsung tersedia di sistem pusat setelah sinkronisasi. |
| T-5 | Menjaga kendali jumlah barang diterima vs dipesan. | Kelebihan terima selalu terdeteksi dan menunggu persetujuan. |
| T-6 | Menjaga keamanan akses aplikasi. | Kredensial yang diubah di pusat tidak dapat dipakai lagi di device. |

---

## 4. Manfaat yang Diharapkan

### 4.1 Manfaat Operasional

- Penerimaan barang dapat dilakukan **kapan pun**, tanpa menunggu internet.
- Proses scan barcode memangkas waktu identifikasi barang.
- Petugas tidak perlu mencatat dua kali (kertas lalu sistem).
- Supervisor/admin dapat segera melihat hasil penerimaan begitu device tersinkron.

### 4.2 Manfaat Pengendalian

- Kelebihan penerimaan (over-receive) **tidak pernah lolos tanpa persetujuan**.
- Total penerimaan dari banyak petugas/device untuk satu PO **terhitung terpusat dan konsisten**.
- Setiap dokumen penerimaan memiliki **nomor resmi yang unik** dan dapat ditelusuri.

### 4.3 Manfaat Bisnis (ringkasan kualitatif)

- Mengurangi waktu siklus "barang datang → tercatat di sistem".
- Mengurangi risiko salah catat yang berdampak pada stok dan keuangan.
- Meningkatkan kepuasan kerja petugas gudang karena alat kerja yang lebih andal.

> *Catatan: perkiraan nilai manfaat dalam angka (penghematan waktu/jam kerja) sebaiknya divalidasi dengan data operasional aktual sebelum proyek berjalan.*

---

## 5. Pemangku Kepentingan (Stakeholder)

### 5.1 Daftar & Kepentingan

| Stakeholder | Peran | Kepentingan Utama | Keterlibatan |
| --- | --- | --- | --- |
| **Pemilik Bisnis / Manajemen** | Pengambil keputusan | Efisiensi proses, kendali jumlah, keamanan data | Menyetujui BRD/PRD, memutuskan kebijakan over-receive |
| **Petugas Gudang (operator PDT)** | Pelaksana harian penerimaan | Cepat, mudah, tidak terganggu koneksi internet | Pengguna utama aplikasi; sumber umpan balik UAT |
| **Supervisor Gudang** | Pengawas lapangan | Kelancaran operasi, kejelasan status dokumen | Memantau antrian sinkronisasi & selisih |
| **Admin (pengguna website administrasi)** | Pengelola dokumen | Dokumen penerimaan masuk otomatis, kontrol over-receive | Menyetujui over-receive, proses lanjutan dokumen |
| **Tim IT / Pengembang** | Penyedia & pemelihara sistem | Sistem stabil, aman, mudah dipelihara | Pembangunan, konfigurasi device, pemeliharaan |
| **Vendor (pemasok barang)** | Pihak eksternal | Dokumen serah terima (invoice/DO) tercatat benar | Menyediakan barang, invoice, dan surat jalan |
| **Bagian Keuangan** | Pengguna data penerimaan | Data jumlah & nilai akurat untuk pembayaran | Menerima data dari sistem administrasi |

### 5.2 Dampak Perubahan bagi Stakeholder

| Stakeholder | Perubahan yang Dialami |
| --- | --- |
| Petugas Gudang | Dari pencatatan manual/website online menjadi scan barcode di PDT yang tetap berfungsi offline. |
| Admin | Mendapat dokumen penerimaan baru (`DRAFT`) dari device secara otomatis; ada alur baru persetujuan over-receive. |
| Manajemen | Mendapat kendali yang lebih baik atas kelebihan terima dan keterlambatan pencatatan. |
| Tim IT | Menambah satu aplikasi baru yang terhubung ke database existing (tanpa mengubah strukturnya). |

---

## 6. Proses Bisnis

### 6.1 Proses Saat Ini (AS-IS)

> *Deskripsi berikut berdasarkan informasi yang tersedia saat penyusunan dokumen. Perlu divalidasi dengan pengamatan langsung di gudang.*

1. PO dibuat dan disetujui di sistem administrasi (di luar cakupan proyek ini).
2. Barang dari vendor tiba di gudang.
3. Petugas mencatat penerimaan melalui **website administrasi yang wajib online**.
4. Jika internet bermasalah, petugas mencatat sementara secara manual (kertas/catatan) atau menunda pencatatan.
5. Begitu online, catatan manual diinput ulang ke sistem.
6. Admin memproses lanjutan dokumen penerimaan di sistem administrasi.

**Titik lemah utama:** langkah 3–5 adalah titik kemacetan — bergantung internet dan berpotensi input ganda/salah.

### 6.2 Proses yang Diharapkan (TO-BE)

1. PO disetujui di sistem administrasi sampai status `CHECKED` (tetap di luar aplikasi ini).
2. Saat device online (mis. awal shift), daftar PO `CHECKED` dan data barang otomatis masuk ke device.
3. Barang dari vendor tiba di gudang.
4. Petugas memilih PO, lalu **scan barcode barang dan input jumlah** di PDT — **tanpa perlu internet**.
5. Petugas mengisi nomor invoice dan surat jalan (DO), lalu menandai sesi selesai.
6. Begitu device kembali online, hasil penerimaan **terkirim otomatis** ke sistem pusat dan mendapat nomor dokumen resmi.
7. Jika ada kelebihan jumlah vs pesanan, item tersebut ditandai dan menunggu persetujuan admin.
8. Admin memproses dokumen (`DRAFT` → lanjut) di sistem administrasi seperti biasa.

### 6.3 Perbandingan

| Aspek | AS-IS | TO-BE |
| --- | --- | --- |
| Ketergantungan internet saat menerima | Wajib | Tidak ada (offline penuh) |
| Cara identifikasi barang | Ketik manual | Scan barcode |
| Input ulang | Ada (manual → sistem) | Tidak ada (sinkronisasi otomatis) |
| Kendali kelebihan terima | Manual/tidak ada | Otomatis + persetujuan admin |
| Multi-petugas pada satu PO | Sulit dikendalikan | Dihitung terpusat |

---

## 7. Kebutuhan Bisnis

Kebutuhan berikut ditulis dalam bahasa bisnis (tanpa istilah teknis). Rincian produknya ada di PRD.

### 7.1 Operasional Penerimaan

| ID | Kebutuhan Bisnis | Alasan |
| --- | --- | --- |
| B-1 | Sistem **harus dapat digunakan tanpa internet** untuk seluruh kegiatan penerimaan (login, melihat PO, scan, input, menyimpan). | Gudang sering tanpa koneksi (masalah M-1). |
| B-2 | Sistem **harus mengambil sendiri daftar PO yang siap dikerjakan** (status `CHECKED`) dari sistem pusat saat tersedia koneksi. | Petugas tidak perlu input ulang data PO. |
| B-3 | **Tidak ada pembuatan PO** di aplikasi ini; PO sepenuhnya milik sistem administrasi. | Batas tanggung jawab sistem (menghindari duplikasi fungsi). |
| B-4 | Barang **diidentifikasi dengan scan barcode**; kode barang juga dapat dicari bila barcode rusak. | Cepat dan akurat (masalah M-3). |
| B-5 | Petugas mencatat **jumlah barang dalam satuan yang sama dengan PO**, supaya tidak ada kebingungan konversi di lapangan. | Menghindari salah hitung. |
| B-6 | **Nomor invoice dan nomor surat jalan (DO) wajib dicatat** pada setiap penerimaan. | Kelengkapan dokumen untuk admin/keuangan. |
| B-7 | **Satu kegiatan scan = satu dokumen penerimaan.** Petugas boleh berhenti sebentar lalu melanjutkan kegiatan yang sama. | Fleksibilitas kerja lapangan. |
| B-8 | **Satu PO boleh dikerjakan lebih dari satu petugas/device** secara bersamaan. | Barang satu pengiriman bisa dihitung beberapa orang sekaligus. |
| B-9 | Hasil penerimaan **otomatis masuk ke sistem pusat** begitu device online, **tanpa duplikasi** meskipun koneksi sempat putus saat pengiriman. | Menghilangkan input ulang (masalah M-2) dan menjaga keakuratan. |

### 7.2 Pengendalian & Persetujuan

| ID | Kebutuhan Bisnis | Alasan |
| --- | --- | --- |
| B-10 | **Total barang yang diterima tidak boleh melebihi jumlah yang dipesan tanpa persetujuan.** Bila melebihi, barang tersebut tetap dicatat namun **ditandai dan menunggu persetujuan admin**. | Kendali stok & tagihan (masalah M-4, M-5). |
| B-11 | Perhitungan "sudah diterima vs dipesan" dihitung **terpusat** untuk satu PO, menggabungkan semua petugas/device. | Konsistensi antar petugas. |
| B-12 | Dokumen penerimaan dari aplikasi ini berstatus **`DRAFT`**; proses persetujuan selanjutnya tetap di sistem administrasi. | Tidak mengubah alur tanggung jawab admin. |
| B-13 | Setiap dokumen penerimaan mendapat **nomor resmi yang unik** dari sistem, dan tidak mungkin bentrok dengan nomor dokumen buatan sistem administrasi. | Ketertelusuran dokumen. |
| B-14 | Dokumen yang sudah terkirim ke pusat **tidak dapat diubah lagi dari device**. | Mencegah perbedaan data. |

### 7.3 Keamanan & Akses

| ID | Kebutuhan Bisnis | Alasan |
| --- | --- | --- |
| B-15 | Petugas **login dengan ID dan password** yang sama dengan sistem yang berlaku. Login tetap bisa dilakukan tanpa internet setelah pernah login di device itu. | Kemudahan + tetap aman. |
| B-16 | Petugas **boleh login di device mana pun**. | Fleksibilitas penugasan. |
| B-17 | **Tanpa login online, akses offline dibatasi maksimal 7 hari**; setelah itu wajib login online kembali. | Keamanan bila device jatuh ke tangan yang salah. |
| B-18 | **Perubahan ID atau password petugas di sistem pusat harus segera berlaku** — pada kesempatan sinkronisasi berikutnya, device mencabut akses offline dengan kredensial lama (untuk semua petugas yang pernah login di device itu). | Kredensial lama tidak boleh terus dipakai. |
| B-19 | Password **tidak boleh tersimpan apa adanya** di device. | Keamanan data bila device hilang. |

### 7.4 Data & Ketersediaan

| ID | Kebutuhan Bisnis | Alasan |
| --- | --- | --- |
| B-20 | Seluruh data yang dibutuhkan untuk bekerja (PO, master barang aktif, satuan, vendor) **terunduh otomatis ke device saat login pertama**, dan tersedia tombol **unduh ulang** untuk memperbarui. | Kesiapan kerja offline. |
| B-21 | Sistem **tidak mengubah struktur database** sistem administrasi yang sudah ada. | Menghindari risiko pada sistem yang sedang berjalan. |
| B-22 | Petugas **selalu dapat melihat status** pekerjaannya: belum selesai, menunggu terkirim, terkirim, atau gagal terkirim. | Kepastian kerja, tidak ada dokumen "hilang". |

---

## 8. Aturan Bisnis

Aturan yang mengikat proses penerimaan barang (penjelasan rinci ada di PRD, bagian Aturan Bisnis):

| ID | Aturan Bisnis |
| --- | --- |
| AB-1 | Hanya PO berstatus `CHECKED` yang muncul dan boleh diproses di aplikasi penerimaan. |
| AB-2 | Aplikasi penerimaan hanya menghasilkan dokumen berstatus `DRAFT`; status lanjutan menjadi tanggung jawab sistem administrasi. |
| AB-3 | Satu kegiatan scan seorang petugas = satu dokumen penerimaan; satu PO boleh memiliki banyak dokumen penerimaan. |
| AB-4 | Total jumlah yang diterima untuk setiap barang dalam satu PO **tidak boleh melebihi jumlah yang dipesan**, kecuali disetujui admin (over-receive ditandai & menunggu persetujuan; tanpa toleransi untuk saat ini). |
| AB-5 | Perbandingan jumlah dilakukan pada **satuan yang sama dengan PO**; jumlah dicatat petugas langsung dalam satuan PO. |
| AB-6 | Nomor invoice dan nomor surat jalan (DO) **wajib diisi** sebelum dokumen dapat dikirim. |
| AB-7 | Barang yang di-scan **harus merupakan bagian dari PO** yang sedang dikerjakan; barang di luar PO ditolak dengan pemberitahuan. |
| AB-8 | Nomor dokumen resmi dan ID diberikan **oleh sistem pusat saat pengiriman data**, bukan dibuat di device. |
| AB-9 | Batas penggunaan offline tanpa login online adalah **7 hari**. |
| AB-10 | Perubahan ID/password di sistem pusat **dicabut dari device pada sinkronisasi berikutnya** untuk semua petugas yang pernah login di device tersebut. |
| AB-11 | Dokumen yang sudah terkirim ke pusat menjadi **baca-saja** di device. |
| AB-12 | Data master & PO diperbarui dengan **unduh penuh saat login pertama** dan **tombol unduh ulang manual**. |

---

## 9. Ruang Lingkup

### 9.1 Termasuk dalam Proyek (In Scope)

- Aplikasi penerimaan barang untuk PDT (login, daftar PO, scan & input, penyimpanan offline, sinkronisasi).
- Penarikan PO `CHECKED` dan data master dari sistem pusat.
- Pengiriman dokumen penerimaan ke sistem pusat beserta deteksi kelebihan terima.
- Konfigurasi perangkat (pemasangan aplikasi di device).
- Dokumentasi & pelatihan petugas gudang.

### 9.2 Tidak Termasuk (Out of Scope)

- Pembuatan atau perubahan PO.
- Proses persetujuan dokumen penerimaan (`APPROVED`/`CHECKED`) — tetap di sistem administrasi.
- Perubahan struktur database sistem administrasi.
- Filter penerimaan berdasarkan lokasi (direncanakan fase berikutnya).
- Perubahan sistem keamanan password sistem administrasi (password plain text yang ada saat ini dibiarkan; mitigasi hanya di sisi aplikasi/device).
- Pemberitahuan real-time (push) ke device — deteksi perubahan kredensial dilakukan pada sinkronisasi berikutnya.

---

## 10. Asumsi & Batasan

| # | Asumsi / Batasan |
| --- | --- |
| 1 | Perangkat PDT yang digunakan adalah perangkat **Android yang mendukung browser modern** — asumsi perangkat mampu menjalankan aplikasi web offline. *Perlu dikonfirmasi tipe perangkat & versi browsernya.* |
| 2 | Sistem administrasi yang berjalan saat ini **tetap menjadi sumber kebenaran** data PO, master barang, dan dokumen. |
| 3 | Jumlah master barang aktif diperkirakan **±50.000 item**; perangkat diasumsikan mampu menyimpannya. |
| 4 | Ketersediaan internet diasumsikan ada **setidaknya sesekali dalam sehari** di area dengan jangkauan (untuk sinkronisasi); kualitas/kecepatannya tidak menjadi syarat. |
| 5 | Proses bisnis AS-IS pada bagian 6.1 masih bersifat asumsi dan perlu **divalidasi langsung di gudang**. |
| 6 | Kebijakan toleransi kelebihan terima **belum ada**; dapat diusulkan kemudian (misalnya untuk barang timbangan). |
| 7 | Batasan: aplikasi ini **tidak mengubah** cara kerja sistem administrasi (termasuk kebiasaan penyimpanan password-nya). |

---

## 11. Indikator Keberhasilan (KPI)

| ID | Indikator | Definisi | Target (usulan) |
| --- | --- | --- | --- |
| K-1 | Waktu pencatatan per PO | Waktu dari mulai scan barang pertama sampai sesi ditandai selesai | Turun signifikan vs pencatatan manual saat ini *(ditetapkan setelah baseline diukur)* |
| K-2 | Kesiapan offline | Persentase fungsi inti yang dapat dijalankan tanpa internet | 100% untuk login, lihat PO, scan, input, simpan |
| K-3 | Kesalahan identifikasi barang | Jumlah barang salah identifikasi per 1.000 scan | Mendekati 0 |
| K-4 | Dokumen tanpa input ulang | Persentase dokumen penerimaan yang masuk sistem pusat otomatis (tanpa input manual ulang) | 100% |
| K-5 | Kelebihan terima terkendali | Persentase kelebihan terima yang terdeteksi & menunggu persetujuan | 100% terdeteksi |
| K-6 | Kecepatan tersedianya data | Selisih waktu "sesi selesai di device" → "terlihat di sistem pusat" | Secepat sinkronisasi online berikutnya (target < 5 menit saat online) |
| K-7 | Duplikasi dokumen | Jumlah dokumen ganda akibat sinkronisasi ulang | 0 |

> *Target angka final ditetapkan bersama pemilik bisnis setelah pengukuran baseline.*

---

## 12. Risiko Bisnis

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| Perangkat/browser tidak mendukung aplikasi offline. | Proyek tidak jalan di lapangan. | Konfirmasi perangkat sebelum pengembangan; uji coba di 1–2 device lebih awal. |
| Petugas kesulitan beradaptasi dengan PDT. | Penerimaan melambat di awal. | Desain sederhana (layar kecil + tombol besar), pelatihan, masa uji coba. |
| Data PO/master tidak diperbarui di device. | Petugas mengerjakan PO yang sudah tidak berlaku. | Unduh otomatis saat login + tombol unduh ulang + indikator status. |
| Kelebihan terima tidak ditindaklanjuti admin. | Selisih stok/tagihan berlarut. | Worklist admin yang jelas; SOP penanganan over-receive. |
| Perubahan kredensial tidak cepat berlaku di device. | Kredensial lama masih dipakai (maks. sampai sinkronisasi berikutnya). | Disepakati bersama manajemen: batas maksimum 7 hari + pencabutan saat sinkronisasi. |
| Penolakan pemakaian oleh tim administrasi (karena menyentuh sistem yang berjalan). | Proyek tertunda. | Komunikasi sejak awal: aplikasi hanya baca/tulis tabel existing, tanpa mengubah struktur. |

---

## 13. Kriteria Keberhasilan Proyek (Business Acceptance)

Proyek dianggap berhasil dari sisi bisnis bila:

1. Petugas gudang dapat menyelesaikan **seluruh kegiatan penerimaan tanpa internet** (dibuktikan saat uji coba di area tanpa sinyal).
2. Seluruh hasil penerimaan **masuk otomatis ke sistem pusat** tanpa input ulang dan tanpa dokumen ganda.
3. Kelebihan penerimaan **selalu terdeteksi** dan masuk alur persetujuan admin.
4. Dua petugas atau lebih yang mengerjakan PO yang sama menghasilkan **perhitungan total yang benar** di sistem pusat.
5. Kredensial yang diubah di sistem pusat **tidak dapat lagi digunakan** di device setelah sinkronisasi.
6. **Tidak ada gangguan** terhadap sistem administrasi yang sedang berjalan (tanpa perubahan struktur database).
7. Petugas dapat menggunakan aplikasi dengan **pelatihan singkat** (desain sederhana, sesuai perangkat).

---

## 14. Riwayat Perubahan

| Versi | Tanggal | Perubahan |
| --- | --- | --- |
| 1.0 | 26 September 2026 | Versi awal — mencakup masalah, tujuan, proses AS-IS/TO-BE, kebutuhan bisnis (B-1 s.d. B-22), aturan bisnis, ruang lingkup, KPI, dan risiko. |
| 1.1 | 26 September 2026 | Menetralkan sebutan perangkat target menjadi "perangkat PDT Android" (tidak terikat model tertentu). |

---

## 15. Referensi

| Dokumen | Keterangan |
| --- | --- |
| `docs/prd.md` | Product Requirements Document — rincian kebutuhan produk & teknis (fitur, aturan, pemetaan data). |
