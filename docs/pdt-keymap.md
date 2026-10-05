# Peta Tombol Hardware PDT

Dokumen ini diisi oleh tim IT dengan hasil pengukuran di perangkat asli. Selama tabel di bawah masih
kosong, **tidak ada** penangan tombol hardware yang boleh ditambahkan ke aplikasi.

## Cara mengukur

1. Buka aplikasi di perangkat PDT (harus lewat `https://` atau `localhost`).
2. Buka Pengaturan → Info & Diagnostik.
3. Tekan satu per satu tombol fisik perangkat dan catat nilai yang muncul.
   (Kolom diagnostik untuk ini belum ada — tambahkan lebih dulu, atau pakai `adb logcat`.)

## Hasil pengukuran

| Tombol fisik | `event.key` | `event.code` | `event.keyCode` | Dipakai scanner? |
| --- | --- | --- | --- | --- |
| Trigger scan (samping) | | | | |
| Trigger scan (depan) | | | | |
| Tombol fungsi 1 | | | | |
| Tombol fungsi 2 | | | | |
| Enter / OK | | | | |
| Esc / Back | | | | |

## Aturan yang sudah pasti, apa pun hasil pengukurannya

1. **Trigger scan tidak boleh ditangani aplikasi.** Scanner PDT mengetik seperti keyboard: barcode
   masuk sebagai deretan karakter, diakhiri `Enter`. Itu sudah ditangani oleh `onKeyDown` pada field
   barcode di `src/routes/sessions/$sessionId.tsx`. Jangan menambah penangan untuk trigger.
2. **Field scan harus tetap memegang fokus.** Lihat `useEffect` di `SessionDetailPage` yang
   mengembalikan fokus ke `scanRef` setiap kali dialog tertutup. Penangan tombol global **tidak
   boleh** memanggil `focus()` ke elemen lain saat tab Scan aktif.
3. **Penangan global harus mengabaikan event yang berasal dari input.** Periksa
   `event.target instanceof HTMLInputElement` dan keluar bila benar, supaya pengetikan barcode tidak
   memicu aksi.
4. **Setiap pemetaan wajib punya padanan di layar.** Tombol hardware adalah jalan cepat, bukan
   satu-satunya jalan; semua aksi harus tetap bisa disentuh.
5. **Pemetaan dipasang di belakang preferensi** (mati secara default), supaya perangkat dengan
   tata tombol berbeda tidak rusak.

## Pemetaan yang diusulkan (menunggu konfirmasi)

| Aksi | Usulan | Catatan |
| --- | --- | --- |
| Pindah ke tab Dokumen | tombol fungsi 1 | hanya saat tab Scan aktif dan sudah ada item |
| Batalkan scan terakhir | tombol fungsi 2 | hanya saat kartu hasil scan menampilkan tombol undo |
| Tutup pesan error | Esc | sudah bekerja untuk dialog, belum untuk kartu hasil scan |
