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

**Sudah terpasang, tidak menunggu konfirmasi:** `Esc` menutup dialog (edit qty, konfirmasi
finalisasi), menutup sheet keypad, dan membersihkan kartu hasil scan yang menunggu keputusan
operator. Kartu sukses sengaja dikecualikan supaya tombol "Batalkan scan ini" tidak ikut hilang.

---

## Syarat provisioning (berlaku untuk SEMUA perangkat)

Aplikasi ini berjalan di browser/WebView, dan aplikasi web **tidak bisa menerima Android Intent**.

1. **Scanner wajib dalam mode keyboard-wedge** (sering disebut *HID*, *keyboard emulation*, atau
   *keystroke output*). Barcode diketik seperti keyboard dan diakhiri `Enter`.
2. **Mode Intent broadcast harus dimatikan.** Bila aktif, barcode tidak akan pernah sampai ke kolom
   scan. Gejalanya: scanner berbunyi dan lampu menyala, tetapi tidak ada yang bertambah di layar —
   terlihat seperti aplikasi rusak, padahal murni konfigurasi perangkat.
3. **Karakter penutup harus `Enter`**, bukan `Tab` atau tanpa penutup. Dengan `Tab`, fokus akan
   berpindah alih-alih menambahkan item.
4. **Alamat aplikasi harus `https://`** (atau `localhost`). `crypto.subtle` dan service worker
   menuntut secure context: tanpa itu login dan mode offline tidak bekerja sama sekali.

### Kenapa tidak ada kode tombol hardware di aplikasi ini

Pemetaan tombol berbeda-beda antar merek PDT, jadi memetakan satu merek akan merusak merek lain.
Sebagai gantinya seluruh alur dapat diselesaikan dengan tiga hal yang seragam di hampir semua
perangkat: sentuhan, keyboard-wedge scanner, dan navigasi keyboard standar (`Tab`, `Shift+Tab`,
`Enter`, `Escape`, panah kiri/kanan pada bar tab).

Artinya tabel pengukuran di atas **tidak menghalangi apa pun**. Ia hanya diperlukan bila suatu saat
diputuskan untuk menambahkan jalan pintas khusus perangkat.
