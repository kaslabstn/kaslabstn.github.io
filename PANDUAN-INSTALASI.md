# PANDUAN INSTALASI — Kas LabSTN

## Bagian 1: Backend (Google Apps Script)

1. Buka https://script.google.com → **Proyek Baru**.
2. Hapus isi `Code.gs`, lalu **paste seluruh isi `Kode.gs`**. Ganti nama file menjadi `Kode` jika perlu.
3. Di dropdown fungsi, pilih **`setupSecrets`** → klik **▶ Run**.
   - Klik **Review permissions**, izinkan akses Sheets dan Email.
   - Cek Execution log: harus ada tulisan "✅ setupSecrets selesai".
   - Jalankan **sekali saja**.
4. **Deploy → Kelola deployment → Edit (ikon pensil) → Versi baru → Deploy.**
   - Jika belum ada deployment: **Deploy → New deployment → Web app**.
   - **Execute as: Me (Saya)**
   - **Who has access: Anyone (Siapa saja)**
5. Salin URL yang berakhiran **`/exec`**.

> PIN admin dibaca dari sheet **Pengaturan**, baris `ADMIN_PIN`, kolom **Nilai**. Anda bisa mengganti PIN langsung di sel itu atau lewat menu Ganti PIN di aplikasi.
> **Jangan bagikan spreadsheet ini** ke orang lain, karena siapa pun yang punya akses ke spreadsheet bisa membaca PIN.

## Bagian 2: Frontend (GitHub Pages)

### Langkah 1 — Isi URL backend
Buka `index.html` dengan Notepad, cari baris:
```
var GAS_URL = 'https://script.google.com/macros/s/XXXX/exec';
```
Ganti isi tanda kutip dengan URL `/exec` dari Bagian 1. Simpan.

### Langkah 2 — Pastikan folder benar
Folder yang di-`git init` adalah folder **yang berisi `index.html` di paling atas**.
Di PowerShell, jalankan `dir` dan pastikan `index.html` terlihat **sebelum** `git init`.

### Langkah 3 — Push ke GitHub (dari PowerShell, di folder `kas-labstn`)
```
git init
git add .
git commit -m "Upload pertama"
git branch -M main
git remote add origin https://github.com/USERNAME/NAMA-REPO.git
git push -u origin main
```
Ganti `USERNAME` dan `NAMA-REPO`. Saat diminta password, pakai **Personal Access Token** (bukan password akun).
Cara membuat token: github.com → Settings → Developer settings → Personal access tokens → Tokens (classic) → centang **repo**.

### Langkah 4 — Aktifkan GitHub Pages
Repo → **Settings → Pages** → Source: **Deploy from a branch** → Branch: **main**, folder **/ (root)** → **Save**.
Tunggu 1–2 menit. Alamat situs akan muncul: `https://USERNAME.github.io/NAMA-REPO/`

### Langkah 5 — Uji
- Buka alamat situs. Data dashboard harus tampil.
- Login admin dengan PIN. PIN salah harus ditolak.
- Untuk update berikutnya: `git add .` → `git commit -m "..."` → `git push`.

## Catatan keamanan
- Data dashboard (nama anggota, transaksi) **bisa dilihat publik** sesuai keputusan Anda.
- PIN admin dicek di server. Setelah 5 kali salah, login diblokir 10 menit.
- PIN tersimpan di sheet Pengaturan. Setelah ganti PIN di aplikasi, sel itu ikut berubah dan PIN baru langsung berlaku.
- Nomor rekening BCA tertulis di `index.html` dan akan terlihat di repo publik.

## Cara kerja kecepatan
- Saat dibuka, situs langsung menampilkan data terakhir yang tersimpan di browser, lalu mengambil data terbaru dari server di latar belakang.
- Saat menambah, mengedit, atau menghapus, perubahan langsung tampil. Pengiriman ke Google Sheets berjalan di latar belakang, ditandai tulisan **"Menyimpan ke Google Sheets…"** di pojok kanan bawah. Jangan tutup halaman sebelum tulisan itu hilang.
- Server menyimpan cache data selama 5 menit dan menghapusnya setiap kali ada perubahan dari aplikasi.

## Jika ada masalah
| Gejala | Penyebab | Solusi |
|---|---|---|
| Dashboard kosong, muncul "Gagal mengambil data" | `GAS_URL` belum diisi atau salah | Cek URL `/exec` di `index.html` |
| Error "SPREADSHEET_ID belum diatur" | `setupSecrets` belum dijalankan | Jalankan `setupSecrets` dari editor |
| Login selalu ditolak | Sel `ADMIN_PIN` di sheet Pengaturan kosong | Isi PIN di kolom Nilai baris `ADMIN_PIN` |
| Halaman 404 di GitHub Pages | `index.html` bukan di root repo | Lihat Langkah 2 |
| Perubahan kode backend tidak terasa | Deployment belum diperbarui | Deploy → Kelola deployment → Versi baru |
| Data yang diedit langsung di Google Sheets belum muncul di situs | Server menyimpan cache data selama 5 menit | Tunggu maks. 5 menit, atau jalankan fungsi `clearCache` di editor Apps Script |
| Muncul "Perubahan gagal disimpan" | Server menolak (mis. PIN berubah, koneksi putus) | Data di layar otomatis dikembalikan seperti di server. Login ulang lalu coba lagi |
