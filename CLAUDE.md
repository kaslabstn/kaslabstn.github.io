# CLAUDE.md — Kas LabSTN

Catatan proyek untuk Claude Code. Baca ini sebelum mengubah apa pun.

## Tentang proyek & pengguna

- **Kas LabSTN**: dashboard laporan arus kas & WiFi Lab STN (iuran anggota, pemasukan, pengeluaran, status pembayaran, cetak PDF).
- Situs: **https://kaslabstn.github.io** (repo GitHub `kaslabstn/kaslabstn.github.io`, branch `main`, GitHub Pages dari root).
- Pemilik/admin: Rabatang. **Bukan programmer** — jelaskan dalam **Bahasa Indonesia**, langkah kecil, dan bahasa sederhana.
- Komputer: **Windows**, terminal **PowerShell**. Folder proyek: `D:\Dashboard Kas_LabSTN\kas-labstn-frontend`.

## Arsitektur

```
Browser ──fetch──▶ Apps Script /exec (Kode.gs, REST JSON) ──▶ Google Sheets (dikunci, hanya pemilik)
```

- **Frontend**: satu file `index.html` (HTML + CSS + JS inline, Tailwind Play CDN, font Plus Jakarta Sans). Tidak ada build step.
- **Backend**: `Kode.gs` di proyek Google Apps Script, deploy sebagai Web App
  (**Jalankan sebagai: Saya**, **Akses: Siapa saja**).
- **URL /exec** ada di `index.html` → variabel `GAS_URL`.
- Spreadsheet sudah **Dibatasi** (hanya pemilik). Situs tetap jalan karena Apps Script berjalan atas nama pemilik.

## File di folder ini

| File | Keterangan |
|---|---|
| `index.html` | Seluruh aplikasi frontend |
| `favicon.svg`, `apple-touch-icon.png` | Ikon (logo dompet) |
| `README.md`, `PANDUAN-INSTALASI.md` | Dokumentasi untuk pengguna |
| `.gitignore` | Mengabaikan `*.gs`, `appsscript.json`, screenshot (`cmp-*.png`, `popup-*.png`) |
| `Kode.gs` | **Salinan lokal backend — sengaja diabaikan Git, JANGAN di-commit** |

## Aturan keamanan (wajib dipertahankan)

1. **PIN admin tidak pernah dikirim ke browser.** `getAppData()` hanya mengembalikan `members`, `categories`, `transactions`, dan `cardColors` (warna kartu, bukan rahasia).
2. **PIN dicek di server**: login → `verifyPin`; setiap aksi tulis di `doPost` wajib `payload.pin` yang cocok (`checkPin_`).
   Batas 5x salah / 10 menit.
3. PIN disimpan di sheet **Pengaturan**, baris `ADMIN_PIN` (kolom Nilai). Tidak ada PIN cadangan (`'1234'` sudah dihapus — jangan dikembalikan).
4. Di browser, PIN hanya ada di variabel memori `sessionPin` (hilang saat tab ditutup). **Jangan** simpan PIN ke localStorage.
5. **Jangan** commit `Kode.gs`, ID spreadsheet, atau email admin ke repo (repo publik).

## Backend (Kode.gs) — ringkas

- `doGet(e)`: `?action=getAppData` → data dashboard (lewat cache `getAppDataCached_`, CacheService dipecah per 90 KB, TTL 5 menit).
- `doPost(e)`: body JSON `{action, args, pin}` (Content-Type `text/plain`), dispatch lewat tabel `ACTIONS`:
  - Tulis (admin + lock + hapus cache): `addTransaction`, `updateTransaction`, `deleteTransaction`, `addMember`, `updateMember`, `deleteMember`, `addCategory`, `saveCardColors`
  - Lainnya: `verifyPin`, `changeAdminPin` (cek oldPin), `sendResetPinEmail` (OTP via email, jeda 60 dtk), `resetAdminPinWithOtp` (OTP di cache 10 menit, sekali pakai)
- ID dibuat di frontend (`TX-<ms>`, `MB-<ms>`, `CAT-<ms>`) dan dipakai server lewat `safeId_()` agar cocok dengan tampilan optimistic.
- `setupSecrets()` (sekali): simpan SPREADSHEET_ID ke Script Properties. `clearCache()`: paksa data terbaru tampil setelah edit manual di Sheets.
- Sheet: `Transaksi` (ID, Tanggal, Jenis Tipe, Kategori, Nama Orang, Bulan Dibayar, Jumlah, Keterangan), `Orang` (ID, Nama, Kas, WiFi, Masuk YYYY-MM, Status AKTIF/BERHENTI, Keluar, Inisial 1-3 huruf), `Kategori` (ID, Jenis, Nama), `Pengaturan` (Kunci, Nilai).

## Frontend (index.html) — pola penting

- **Penghubung**: `window.google.script.run` adalah *shim* (Proxy) yang meneruskan ke `gasCall(action, args)` via `fetch`. Kode lama yang memanggil `google.script.run.xxx()` tetap jalan.
- **Instant UX**:
  - Data terakhir disimpan di localStorage (`kaslabstn_data_v1`) → tampil seketika saat dibuka, lalu `fetchData({silent:true})`.
  - Simpan/edit/hapus: ubah `appState` dulu → `syncWrite(action, args)` mengirim di latar belakang secara berurutan (`writeQueue`), menampilkan penanda "Menyimpan perubahan…", lalu refresh senyap. Jika gagal → popup Gagal + ambil ulang data server.
  - `initAppView()` mempertahankan halaman aktif (`currentView`/`currentTitle`) dan posisi scroll; pemuatan pertama membuka halaman terakhir di tab itu (`sessionStorage`, kunci `kaslabstn_last_view_v2`, ikut menyimpan judul halaman, jadi naikkan versinya jika judul diganti), atau Beranda jika belum ada.
- **Popup**: `showCustomToast(pesan, jenis, callback)` — jenis: `'success'` (hijau, tutup otomatis 1,2 dtk) / `'notice'` (Informasi, hijau ⓘ) / `'warning'` (kuning) / `'error'` (merah). `true` = success, `false` = error. Konfirmasi hapus (`showCustomConfirm`) berwarna merah.
- **Tambah transaksi**: tombol `.add-btn` di header Pemasukan & Pengeluaran (terlihat semua orang; non-admin dapat popup Peringatan). `openModalTx('INCOME'|'EXPENSE')` + `setTxTypeOptions()` membatasi Jenis Tipe. Fitur "Edit Transaksi per Orang" sudah dihapus.
- **Istilah UI**: pakai "Anggota" (bukan "Orang"), "Masuk" (bukan "Login"), "Beranda" (bukan "Dashboard"), "Tren" (bukan "Trend"). Nilai data (`Pemasukan Kas`, `AKTIF`, `YYYY-MM`, ` s/d `) jangan diubah; ubah tampilannya saja lewat `formatDateId`, `formatMonthId`, `incomeMonthLabel`.
- **PIN = Password**: semua teks yang dilihat pengguna memakai kata "Password". Nama internal tetap memakai "pin" (`sessionPin`, `payload.pin`, `verifyPin`, `checkPin_`, baris sheet `ADMIN_PIN`); jangan diganti tanpa memperbarui backend dan sheet sekaligus. Aturan keamanan di atas berlaku untuk password ini.
- **Ketentuan password baru**: minimal 8 karakter dengan huruf, angka, dan simbol. Dicek di `Kode.gs` (`validateNewPassword_`, penentu akhir) dan di form (`passwordRules`, `renderPasswordStrength`); ubah keduanya bersamaan. Bar: Lemah merah dan Sedang kuning ditolak, Kuat hijau dan Sangat Kuat (≥12 karakter) hijau tua diterima.
- **Ikon anggota di Beranda** (`renderMemberIcons`; inisial dari kolom Inisial sheet `Orang`, cadangan `MEMBER_INITIALS`): kartu "Ringkasan Status Pembayaran (sampai bulan terpilih)" berisi satu baris anggota aktif menurut urutan data dan pil Lunas/Menunggak di kanan atas sejajar judul (turun ke bawah judul jika layar sempit), yang bisa diklik untuk menyaring (`setMemberFilter`); lunas hijau bercentang, menunggak abu-abu. Keterangan ikon (`showMemberTip`) muncul saat kursor mengarah, disentuh/diklik, atau fokus keyboard: menunggak = nama + tunggakan (bulannya sudah tampil di judul kartu), lunas = nama saja. Popup daftar nama (`showMemberDetailListModal`, `modalMemberListDetail`) sudah tidak dipanggil.
- **Grafik Saldo Bersih** (`renderBalanceChart`, halaman Grafik Keuangan): saldo harian dari seluruh transaksi, rentang 1/3/6 bulan, 1 tahun, Maks; tidak mengikuti filter tahun di header. Hanya digambar saat halamannya terbuka (`navigateTo` memanggilnya lagi).
- **Petunjuk isian form** (`indonesianValidityMessage`): pesan validasi bawaan browser diganti Bahasa Indonesia untuk semua form.
- **Jenis transaksi** (`typeBadgeHtml`): hanya warna tulisan, hijau Pemasukan Kas, biru Pemasukan WiFi, merah semua Pengeluaran; juga pada hasil cetak.
- **Popup Masuk dan Transaksi**: warna tombol dan fokus isian dari `--modal-accent`; hijau untuk Masuk dan Pemasukan, merah untuk Pengeluaran.
- **Nominal kartu saldo** (`.saldo-amount`): font Kaushan Script dari Google Fonts (gratis), pengganti terdekat Mystical Woods Rough Script yang berbayar; format `Rp 1.234.000`.
- **Warna kartu** (Pengaturan → kartu Warna Kartu membuka popup `modalCardColor`, hanya admin; `CARD_COLORS`, `CARD_THEMES`, `applyCardColors`): warna kotak ikon dan ikon garis besar empat kartu saldo serta aksen ringkasan, disimpan admin di baris `CARD_COLORS` sheet Pengaturan dan berlaku untuk semua pengunjung.
- **Mode gelap**: pilihan Terang/Gelap di kaki menu samping (`setTheme`, localStorage `kaslabstn_theme`). Warna `slate` dan warna pucat dipetakan ke variabel CSS lewat `tailwind.config`; nilai gelapnya ada di blok `@media screen` pada `html.dark`, jadi hasil cetak selalu terang. Warna yang ditulis di JS (grafik, transaksi terbaru) memakai `isDarkTheme()`.
- **Tabel di HP**: tabel `.m-cards` tampil sebagai kartu di layar ≤640px; label tiap baris berasal dari atribut `data-label` pada `<td>`.
- **Mobile**: header kartu satu baris (judul kiri, tombol kanan); filter `.filter-bar` = grid 2 kolom di HP (`sm:` kembali ke flex). Input/select form di HP 16px (cegah zoom iOS), kecuali filter halaman 13px (iPhone dicegah zoom lewat `maximum-scale` di `<head>`); target sentuh ≥44px.
- Efek hover tombol dibungkus `@media (hover: hover)` agar tidak "tersangkut" di HP.
- Cetak PDF: kelas `body.print-mode-*` + `.no-print`. Pastikan perubahan tampilan tidak merusak hasil cetak.

## Cara deploy

**Frontend** (dari folder proyek di PowerShell):
```
cd "D:\Dashboard Kas_LabSTN\kas-labstn-frontend"
git add .
git commit -m "keterangan perubahan"
git push
```
Tunggu 1–2 menit, buka situs, tekan Ctrl+Shift+R.

**Backend**: tempel `Kode.gs` ke editor Apps Script → Simpan → **Terapkan → Kelola deployment → Edit → Versi baru → Terapkan**.
**Jangan** pakai "New deployment" (URL /exec berubah dan situs putus).
Jika frontend dan backend sama-sama berubah, pasang backend lebih dulu.

## Saat mengubah kode

- Ubah seminimal mungkin; desain & teks UI dalam Bahasa Indonesia, gaya yang ada (rounded, Tailwind, ikon SVG inline — bukan emoji).
- Setelah mengedit `index.html`: cek sintaks script, uji tampilan HP (≈390px) dan desktop, uji alur admin (login, tambah, edit, hapus) dan hasil cetak.
- Jangan menyalakan kembali pemindai banner Google Apps Script (MutationObserver/setInterval 150 ms) — sudah dihapus karena membebani browser.

## Ide yang ditunda

- **Pengingat otomatis untuk anggota yang menunggak** (Email/WhatsApp): ditunda — pemilik khawatir mengganggu anggota.
  Jika dilanjutkan: mulai dari tombol WhatsApp manual di dashboard, nada informatif, maksimal sebulan sekali.
  Perlu kolom kontak di sheet `Orang` dan logika status menunggak dipindah ke `Kode.gs`.
