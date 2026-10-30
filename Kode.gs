/**
 * Laporan Arus Kas & WiFi Lab STN — Backend REST API (Apps Script)
 *
 * Frontend (GitHub Pages) memanggil URL /exec ini:
 *  - GET  ?action=getAppData            → data dashboard (publik, tanpa PIN)
 *  - POST {action, args, pin}           → tulis data (wajib PIN admin, dicek di server)
 *
 * ID spreadsheet tersimpan di Script Properties (diatur lewat setupSecrets()).
 * PIN admin tersimpan di sheet "Pengaturan" (baris ADMIN_PIN) dan hanya dibaca server.
 */

const SHEETS = {
  TRANSACTIONS: 'Transaksi',
  MEMBERS: 'Orang',
  CATEGORIES: 'Kategori',
  SETTINGS: 'Pengaturan'
};

// Email tujuan kode OTP reset PIN
const TARGET_ADMIN_EMAIL = 'athankr@gmail.com';

const INITIAL_MEMBERS = [
  "Firman Muttaqin", "Heriyanto", "Irpan Hermawan", "Rabatang",
  "Pandu Kuncoroningrat", "Wardian Sardi", "Clinton Siregar", "Abdul Latif",
  "Fandy Fahrizal", "Hermi Jumiati", "Juli Yanto", "Refi Abidzar Aulia",
  "Sappe Supiani", "Wiwi Rahayu", "Eko Haryanto", "M. Ihwan Pansori",
  "M. Khairil Anshor"
];

const INITIAL_CATEGORIES = [
  { type: 'Pemasukan Kas', name: 'Iuran Kas Bulanan' },
  { type: 'Pemasukan WiFi', name: 'Iuran WiFi Bulanan' },
  { type: 'Pemasukan Kas', name: 'Donasi / Lainnya' },
  { type: 'Pengeluaran Kas', name: 'Pembelian Alat Lab' },
  { type: 'Pengeluaran Kas', name: 'Konsumsi Meeting' },
  { type: 'Pengeluaran WiFi', name: 'Bayar Tagihan Wifi' },
  { type: 'Pengeluaran WiFi', name: 'Maintenance Router/Kabel' }
];

// Daftar action yang boleh dipanggil dari frontend.
// admin: true = wajib PIN admin yang benar di setiap pemanggilan.
// write: true = mengubah sheet → dijalankan dengan kunci (lock) lalu cache data dihapus.
const ACTIONS = {
  verifyPin:            { admin: false, write: false, fn: verifyPinWithLimit },
  addTransaction:       { admin: true,  write: true,  fn: addTransaction },
  updateTransaction:    { admin: true,  write: true,  fn: updateTransaction },
  deleteTransaction:    { admin: true,  write: true,  fn: deleteTransaction },
  addMember:            { admin: true,  write: true,  fn: addMember },
  updateMember:         { admin: true,  write: true,  fn: updateMember },
  deleteMember:         { admin: true,  write: true,  fn: deleteMember },
  addCategory:          { admin: true,  write: true,  fn: addCategory },
  changeAdminPin:       { admin: false, write: false, fn: changeAdminPin },        // memeriksa oldPin sendiri
  sendResetPinEmail:    { admin: false, write: false, fn: sendResetPinEmail },     // dibatasi 60 detik
  resetAdminPinWithOtp: { admin: false, write: false, fn: resetAdminPinWithOtp }   // wajib kode OTP
};

// Cache data dashboard di server (CacheService). Dihapus otomatis setiap ada perubahan.
const DATA_CACHE_KEY = 'appData_v1';
const DATA_CACHE_TTL = 300; // 5 menit: batas maksimal jika sheet diedit manual

// ============================================
// ENTRY POINTS
// ============================================

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || '';
    if (action === 'getAppData') return json_(getAppDataCached_());
    return json_({ success: true, message: 'API Kas LabSTN aktif' });
  } catch (err) {
    return json_({ success: false, message: err.message });
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = String(payload.action || '');
    const args = Array.isArray(payload.args) ? payload.args : [];
    const rule = ACTIONS[action];

    if (!rule) return json_({ success: false, message: 'Action tidak dikenal' });

    if (rule.admin && !checkPin_(payload.pin)) {
      return json_({ success: false, message: 'PIN admin salah atau sesi sudah berakhir. Silakan login ulang.' });
    }

    if (!rule.write) return json_(rule.fn.apply(null, args));

    // Aksi tulis: satu per satu (mencegah dua admin menulis bersamaan), lalu hapus cache
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) {
      return json_({ success: false, message: 'Server sedang sibuk menyimpan data lain. Coba lagi sebentar.' });
    }
    try {
      const result = rule.fn.apply(null, args);
      SpreadsheetApp.flush();
      invalidateDataCache_();
      return json_(result);
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ success: false, message: err.message });
  }
}

// ============================================
// CACHE DATA (CacheService, dipecah per 90 KB karena batas 100 KB per kunci)
// ============================================

function getAppDataCached_() {
  const cache = CacheService.getScriptCache();
  try {
    const meta = cache.get(DATA_CACHE_KEY + '_n');
    if (meta) {
      const n = Number(meta);
      const keys = [];
      for (let i = 0; i < n; i++) keys.push(DATA_CACHE_KEY + '_' + i);
      const parts = cache.getAll(keys);
      if (keys.every(k => parts[k] !== undefined)) {
        return JSON.parse(keys.map(k => parts[k]).join(''));
      }
    }
  } catch (e) {
    Logger.log('Cache baca gagal: ' + e.message);
  }

  const data = getAppData();
  try {
    const text = JSON.stringify(data);
    const size = 90000;
    const obj = {};
    let n = 0;
    for (let i = 0; i < text.length; i += size) obj[DATA_CACHE_KEY + '_' + (n++)] = text.substring(i, i + size);
    obj[DATA_CACHE_KEY + '_n'] = String(n);
    cache.putAll(obj, DATA_CACHE_TTL);
  } catch (e) {
    Logger.log('Cache simpan gagal: ' + e.message);
  }
  return data;
}

function invalidateDataCache_() {
  CacheService.getScriptCache().remove(DATA_CACHE_KEY + '_n');
}

// Jika script terikat ke spreadsheet, edit manual di sheet langsung menghapus cache.
// Jika tidak terikat, cache tetap kedaluwarsa sendiri dalam 5 menit.
function onEdit() {
  invalidateDataCache_();
  CacheService.getScriptCache().remove('adminPin');
}

// Jalankan manual dari editor jika ingin perubahan di sheet langsung tampil
function clearCache() {
  invalidateDataCache_();
  CacheService.getScriptCache().remove('adminPin');
  Logger.log('✅ Cache dihapus');
}

// ============================================
// KONFIGURASI RAHASIA (Script Properties)
// ============================================

function getSS() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('SPREADSHEET_ID belum diatur. Jalankan setupSecrets() dulu.');
  return SpreadsheetApp.openById(id);
}

// PIN admin dibaca dari sheet Pengaturan, baris dengan Kunci = ADMIN_PIN
function getAdminPin_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('adminPin');
  if (cached !== null) return cached;
  const pin = readAdminPinFromSheet_();
  if (pin) cache.put('adminPin', pin, 300);
  return pin;
}

function readAdminPinFromSheet_() {
  const sheet = getSS().getSheetByName(SHEETS.SETTINGS);
  if (!sheet) return '';
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === 'ADMIN_PIN') return String(data[i][1] || '').trim();
  }
  return '';
}

function setAdminPin_(newPin) {
  CacheService.getScriptCache().put('adminPin', String(newPin), 300);
  const ss = getSS();
  let sheet = ss.getSheetByName(SHEETS.SETTINGS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEETS.SETTINGS);
    sheet.appendRow(['Kunci', 'Nilai']);
  }
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === 'ADMIN_PIN') {
      sheet.getRange(i + 1, 2).setValue("'" + newPin);
      return;
    }
  }
  sheet.appendRow(['ADMIN_PIN', "'" + newPin]);
}

function checkPin_(pin) {
  const real = getAdminPin_();
  return !!real && String(pin || '') === real;
}

/**
 * Jalankan SEKALI dari editor (pilih fungsi → Run).
 * Menyimpan ID spreadsheet ke Script Properties.
 * PIN admin tetap di sheet Pengaturan (tidak diubah).
 */
function setupSecrets() {
  const SPREADSHEET_ID_ISI = '1D82hzFVn6vBGQGC6AULmOdksdeX24NV0FOLHgiCatYM';
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', SPREADSHEET_ID_ISI);
  SpreadsheetApp.openById(SPREADSHEET_ID_ISI); // memastikan ID benar & izin akses diberikan
  if (!getAdminPin_()) {
    throw new Error('Baris ADMIN_PIN di sheet Pengaturan kosong. Isi PIN di kolom Nilai, lalu jalankan lagi.');
  }
  Logger.log('✅ setupSecrets selesai. SPREADSHEET_ID tersimpan, PIN admin terbaca dari sheet Pengaturan.');
}

// ============================================
// SETUP SHEET (opsional, hanya jika sheet belum ada)
// ============================================

function setupDatabase() {
  const ss = getSS();

  if (!ss.getSheetByName(SHEETS.MEMBERS)) {
    const sheet = ss.insertSheet(SHEETS.MEMBERS);
    sheet.appendRow(['ID', 'Nama Orang', 'Nominal Kas Bulanan', 'Nominal WiFi Bulanan', 'Bulan/Tahun Masuk', 'Status', 'Bulan/Tahun Keluar']);
    INITIAL_MEMBERS.forEach((name, idx) => {
      sheet.appendRow([idx + 1, name, 30000, 30000, '2026-01', 'AKTIF', '']);
    });
    sheet.getRange('A1:G1').setFontWeight('bold').setBackground('#e0e7ff');
  }

  if (!ss.getSheetByName(SHEETS.CATEGORIES)) {
    const sheet = ss.insertSheet(SHEETS.CATEGORIES);
    sheet.appendRow(['ID', 'Jenis Kategori', 'Nama Kategori']);
    INITIAL_CATEGORIES.forEach((cat, idx) => sheet.appendRow([idx + 1, cat.type, cat.name]));
    sheet.getRange('A1:C1').setFontWeight('bold').setBackground('#e0e7ff');
  }

  if (!ss.getSheetByName(SHEETS.TRANSACTIONS)) {
    const sheet = ss.insertSheet(SHEETS.TRANSACTIONS);
    sheet.appendRow(['ID Transaksi', 'Tanggal', 'Jenis Tipe', 'Kategori', 'Nama Orang', 'Bulan Dibayar', 'Jumlah (Rp)', 'Keterangan']);
    sheet.getRange('A1:H1').setFontWeight('bold').setBackground('#e0e7ff');
  }

  if (!ss.getSheetByName(SHEETS.SETTINGS)) {
    const sheet = ss.insertSheet(SHEETS.SETTINGS);
    sheet.appendRow(['Kunci', 'Nilai']);
    sheet.appendRow(['ADMIN_PIN', '']); // isi PIN admin di kolom Nilai
    sheet.appendRow(['ADMIN_EMAIL', TARGET_ADMIN_EMAIL]);
    sheet.getRange('A1:B1').setFontWeight('bold').setBackground('#e0e7ff');
  }
}

// ============================================
// BACA DATA (publik)
// ============================================

function getAppData() {
  const ss = getSS();
  const tz = ss.getSpreadsheetTimeZone();

  const memberData = ss.getSheetByName(SHEETS.MEMBERS).getDataRange().getValues();
  const members = [];
  for (let i = 1; i < memberData.length; i++) {
    const name = String(memberData[i][1] || '').trim();
    if (memberData[i][0] !== '' && memberData[i][0] !== undefined && name !== '') {
      let joinedMonth = memberData[i][4];
      joinedMonth = joinedMonth instanceof Date
        ? Utilities.formatDate(joinedMonth, tz, 'yyyy-MM')
        : String(joinedMonth || '2026-01').trim().substring(0, 7);

      let resignedMonth = memberData[i][6];
      resignedMonth = resignedMonth instanceof Date
        ? Utilities.formatDate(resignedMonth, tz, 'yyyy-MM')
        : (resignedMonth ? String(resignedMonth).trim().substring(0, 7) : '');

      members.push({
        id: String(memberData[i][0]),
        name: name,
        feeKas: Number(memberData[i][2]) || 30000,
        feeWifi: Number(memberData[i][3]) || 30000,
        joinedMonth: joinedMonth,
        status: String(memberData[i][5] || 'AKTIF').trim(),
        resignedMonth: resignedMonth
      });
    }
  }

  const catData = ss.getSheetByName(SHEETS.CATEGORIES).getDataRange().getValues();
  const categories = [];
  for (let i = 1; i < catData.length; i++) {
    if (catData[i][0] !== '' && catData[i][0] !== undefined) {
      categories.push({
        id: String(catData[i][0]),
        type: String(catData[i][1] || ''),
        name: String(catData[i][2] || '')
      });
    }
  }

  const txSheet = ss.getSheetByName(SHEETS.TRANSACTIONS);
  const txData = txSheet.getDataRange().getValues();
  const txDisplay = txSheet.getDataRange().getDisplayValues();
  const transactions = [];
  for (let i = 1; i < txData.length; i++) {
    if (txData[i][0] !== '' && txData[i][0] !== undefined) {
      let txDate = txDisplay[i][1] || '';
      if (txData[i][1] instanceof Date) txDate = Utilities.formatDate(txData[i][1], tz, 'yyyy-MM-dd');

      let cleanMonth = txDisplay[i][5] || '-';
      if (txData[i][5] instanceof Date) cleanMonth = Utilities.formatDate(txData[i][5], tz, 'yyyy-MM');

      transactions.push({
        id: String(txData[i][0]),
        date: String(txDate).trim(),
        type: String(txData[i][2] || ''),
        category: String(txData[i][3] || ''),
        memberName: String(txData[i][4] || '-').trim(),
        monthPaid: String(cleanMonth).trim(),
        amount: Number(txData[i][6]) || 0,
        note: String(txData[i][7] || '')
      });
    }
  }

  // PIN admin TIDAK dikirim ke publik
  return { success: true, members: members, categories: categories, transactions: transactions };
}

// ============================================
// TULIS DATA (wajib PIN admin, dicek di doPost)
// ============================================

function updateMember(data) {
  try {
    const ss = getSS();
    const sheet = ss.getSheetByName(SHEETS.MEMBERS);
    const rows = sheet.getDataRange().getValues();
    const memberId = String(data.id || '').trim();
    const oldName = String(data.oldName || '').trim();
    const newName = String(data.name || '').trim();

    let rowNum = -1;
    for (let i = 1; i < rows.length; i++) {
      const rowId = String(rows[i][0]).trim();
      const rowName = String(rows[i][1]).trim();
      if ((memberId && rowId === memberId) || (!memberId && oldName && rowName === oldName)) {
        rowNum = i + 1;
        break;
      }
    }
    if (rowNum === -1) {
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][1]).trim().toLowerCase() === oldName.toLowerCase()) {
          rowNum = i + 1;
          break;
        }
      }
    }
    if (rowNum === -1) return { success: false, message: 'Data orang tidak ditemukan pada spreadsheet' };

    const resignedMonth = String(data.resignedMonth || '').trim();
    // Satu kali tulis untuk kolom B–G
    sheet.getRange(rowNum, 2, 1, 6).setValues([[
      newName,
      Number(data.feeKas) || 0,
      Number(data.feeWifi) || 0,
      "'" + String(data.joinedMonth || '2026-01').trim(),
      String(data.status || 'AKTIF').trim(),
      resignedMonth ? "'" + resignedMonth : ''
    ]]);

    // Ganti nama di riwayat transaksi: baca kolom E sekali, tulis sekali
    if (oldName && oldName !== newName) {
      const txSheet = ss.getSheetByName(SHEETS.TRANSACTIONS);
      const lastRow = txSheet.getLastRow();
      if (lastRow > 1) {
        const range = txSheet.getRange(2, 5, lastRow - 1, 1);
        const names = range.getValues();
        let changed = false;
        names.forEach(r => { if (String(r[0]).trim() === oldName) { r[0] = newName; changed = true; } });
        if (changed) range.setValues(names);
      }
    }
    return { success: true, message: 'Data orang dan riwayat transaksi berhasil diperbarui' };
  } catch (err) {
    return { success: false, message: 'Gagal memperbarui data orang: ' + err.message };
  }
}

function addMember(data) {
  try {
    const sheet = getSS().getSheetByName(SHEETS.MEMBERS);
    const resignedMonth = String(data.resignedMonth || '').trim();
    sheet.appendRow([
      safeId_(data.id, 'MB-'),
      String(data.name || '').trim(),
      Number(data.feeKas) || 30000,
      Number(data.feeWifi) || 30000,
      "'" + String(data.joinedMonth || '2026-01').trim(),
      String(data.status || 'AKTIF').trim(),
      resignedMonth ? "'" + resignedMonth : ''
    ]);
    return { success: true, message: 'Orang baru berhasil ditambahkan' };
  } catch (err) {
    return { success: false, message: 'Gagal menambah orang: ' + err.message };
  }
}

function deleteMember(id) {
  try {
    const sheet = getSS().getSheetByName(SHEETS.MEMBERS);
    const rows = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]).trim() === String(id).trim()) {
        sheet.deleteRow(i + 1);
        return { success: true, message: 'Orang berhasil dihapus' };
      }
    }
    return { success: false, message: 'Orang tidak ditemukan' };
  } catch (err) {
    return { success: false, message: 'Gagal menghapus orang: ' + err.message };
  }
}

function addTransaction(data) {
  try {
    const ss = getSS();
    const sheet = ss.getSheetByName(SHEETS.TRANSACTIONS);
    const date = data.date || Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
    const monthPaid = String(data.monthPaid || '-');
    sheet.appendRow([
      safeId_(data.id, 'TX-'),
      date,
      String(data.type || ''),
      String(data.category || ''),
      String(data.memberName || '-'),
      monthPaid && monthPaid !== '-' ? "'" + monthPaid : '-',
      Number(data.amount) || 0,
      String(data.note || '')
    ]);
    return { success: true, message: 'Transaksi berhasil ditambahkan' };
  } catch (err) {
    return { success: false, message: 'Gagal menyimpan transaksi: ' + err.message };
  }
}

function updateTransaction(data) {
  try {
    const sheet = getSS().getSheetByName(SHEETS.TRANSACTIONS);
    const rows = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]).trim() === String(data.id).trim()) {
        const rowNum = i + 1;
        const monthPaid = String(data.monthPaid || '-');
        // Satu kali tulis untuk kolom B–H
        sheet.getRange(rowNum, 2, 1, 7).setValues([[
          data.date,
          data.type,
          data.category,
          data.memberName || '-',
          monthPaid && monthPaid !== '-' ? "'" + monthPaid : '-',
          Number(data.amount) || 0,
          data.note || ''
        ]]);
        return { success: true, message: 'Transaksi berhasil diperbarui' };
      }
    }
    return { success: false, message: 'Transaksi tidak ditemukan' };
  } catch (err) {
    return { success: false, message: 'Gagal mengedit transaksi: ' + err.message };
  }
}

function deleteTransaction(id) {
  try {
    const sheet = getSS().getSheetByName(SHEETS.TRANSACTIONS);
    const rows = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]).trim() === String(id).trim()) {
        sheet.deleteRow(i + 1);
        return { success: true, message: 'Transaksi berhasil dihapus' };
      }
    }
    return { success: false, message: 'Transaksi tidak ditemukan' };
  } catch (err) {
    return { success: false, message: 'Gagal menghapus transaksi: ' + err.message };
  }
}

function addCategory(data) {
  try {
    const sheet = getSS().getSheetByName(SHEETS.CATEGORIES);
    sheet.appendRow([safeId_(data.id, 'CAT-'), String(data.type || ''), String(data.name || '')]);
    return { success: true, message: 'Kategori baru berhasil ditambahkan' };
  } catch (err) {
    return { success: false, message: 'Gagal menambah kategori: ' + err.message };
  }
}

// ============================================
// LOGIN & PIN
// ============================================

// Batasi percobaan PIN: maksimal 5 kali salah dalam 10 menit (berlaku global)
function verifyPinWithLimit(pin) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('pinFail') || 0);
  if (fails >= 5) {
    return { success: false, message: 'Terlalu banyak percobaan salah. Coba lagi dalam 10 menit.' };
  }
  const ok = checkPin_(pin);
  if (ok) {
    cache.remove('pinFail');
  } else {
    cache.put('pinFail', String(fails + 1), 600);
  }
  return { success: ok, message: ok ? 'PIN benar' : 'PIN salah' };
}

function changeAdminPin(data) {
  try {
    if (String((data && data.oldPin) || '') !== getAdminPin_()) {
      return { success: false, message: 'Password / PIN lama salah!' };
    }
    const newPin = String((data && data.newPin) || '').trim();
    if (newPin.length < 4) return { success: false, message: 'PIN baru minimal harus 4 karakter!' };

    setAdminPin_(newPin);
    return { success: true, message: 'Password / PIN Admin berhasil diperbarui!' };
  } catch (err) {
    return { success: false, message: 'Gagal mengubah PIN: ' + err.message };
  }
}

// Kirim OTP ke email admin. Dibatasi 1 kali per 60 detik. OTP berlaku 10 menit.
function sendResetPinEmail() {
  try {
    const cache = CacheService.getScriptCache();
    if (cache.get('otpCooldown')) {
      return { success: false, message: 'Kode sudah dikirim. Tunggu 1 menit sebelum meminta lagi.' };
    }
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    cache.put('resetOtp', otpCode, 600);
    cache.put('otpCooldown', '1', 60);

    const subject = 'Kode Verifikasi Reset PIN Admin - Laporan Arus Kas & WiFi Lab STN';
    const body = `Halo Admin,\n\nKode Verifikasi (OTP) untuk mereset PIN Admin:\n\nKODE OTP: ${otpCode}\n\nKode berlaku 10 menit. Masukkan kode ini di aplikasi untuk membuat PIN baru.\n\nJika Anda tidak meminta ini, abaikan email ini.`;
    MailApp.sendEmail(TARGET_ADMIN_EMAIL, subject, body);

    return { success: true, message: `Kode verifikasi OTP telah dikirim ke ${TARGET_ADMIN_EMAIL}. Periksa kotak masuk atau spam.` };
  } catch (err) {
    return { success: false, message: 'Gagal mengirim email verifikasi: ' + err.message };
  }
}

function resetAdminPinWithOtp(data) {
  try {
    const cache = CacheService.getScriptCache();
    const savedOtp = cache.get('resetOtp');
    const inputOtp = String((data && data.otpCode) || '').trim();

    if (!savedOtp || inputOtp !== savedOtp) {
      return { success: false, message: 'Kode OTP salah atau sudah kedaluwarsa! Silakan minta kode baru.' };
    }
    const newPin = String((data && data.newPin) || '').trim();
    if (newPin.length < 4) return { success: false, message: 'PIN baru minimal harus 4 karakter!' };

    setAdminPin_(newPin);
    cache.remove('resetOtp'); // OTP hanya sekali pakai
    return { success: true, message: 'PIN Admin berhasil direset! Silakan masuk dengan PIN baru Anda.' };
  } catch (err) {
    return { success: false, message: 'Gagal reset PIN: ' + err.message };
  }
}

// ============================================
// UTILITAS
// ============================================

// Pakai ID dari aplikasi jika formatnya benar (PREFIX + angka), selain itu buat baru
function safeId_(id, prefix) {
  const s = String(id || '');
  return new RegExp('^' + prefix + '\\d{10,16}$').test(s) ? s : prefix + new Date().getTime();
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
