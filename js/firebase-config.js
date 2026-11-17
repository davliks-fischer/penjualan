// ============================================================
//  js/firebase-config.js  —  SnackZone Firebase Configuration
// ============================================================
//
//  PROJECT: penjualan-e6360
//
//  KEBIJAKAN KONEKSI (fail-closed):
//  - localhost / 127.0.0.1  → SELALU Firestore & Auth Emulator,
//     tanpa perlu flag. Default AMAN (tidak menyentuh produksi).
//  - Domain produksi di allowlist → koneksi Firebase produksi.
//  - Hostname lain (tidak dikenal) → BLOKIR inisialisasi + error jelas.
//     TIDAK ada fallback diam-diam ke produksi.
//  - Tidak ada override localStorage untuk membuka produksi.
//
//  JANGAN PERNAH:
//  - Memasukkan Service Account Private Key di sini
//  - Memasukkan password admin di sini
//  - Meng-commit apiKey nyata ke repository publik
//
// ============================================================

import { initializeApp }              from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore,
         connectFirestoreEmulator }   from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth,
         connectAuthEmulator }        from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { resolveConnectionMode } from "./connection-mode.js";

// ─── KONFIGURASI FIREBASE ────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyB634KgcfG04bziIRJHeuM271dXbDklBXE",
  authDomain:        "penjualan-e6360.firebaseapp.com",
  projectId:         "penjualan-e6360",
  storageBucket:     "penjualan-e6360.firebasestorage.app",
  messagingSenderId: "816217062222",
  appId:             "1:816217062222:web:a2ca0f94e2ac2cbc76bc1f"
};

// ─── MODE RESOLUTION (DILAKUKAN SEBELUM instance dibuat) ─────────────────────
//
//  Keputusan mode (dev/prod/blocked) diimplementasikan di connection-mode.js
//  (fungsi murni, teruji unit). PROD_ALLOWLIST dideklarasikan di sana.
//
const _hostname = (() => {
  try { return window.location.hostname.toLowerCase(); }
  catch { return 'localhost'; }
})();

const _mode = resolveConnectionMode(_hostname);
const _isLocalhost = (_mode === 'dev');
const _isProdHost  = (_mode === 'prod');

// ─── DEFAULT: BLOCKED (null instance) ───────────────────────────────────────
//  Nilai default adalah AMAN: db & auth = null, mode = blocked.
//  Hanya diisi instance nyata bila mode dev/prod terkonfirmasi.
let app  = null;
let db   = null;
let auth = null;
let _connectionMode = 'blocked'; // 'dev' | 'prod' | 'blocked'
let _ready = Promise.resolve(); // resolve segera untuk prod/blocked; untuk dev, menunggu probe

// ── Fungsi banner darurat (block merah) ─────────────────────────────────────
function showBlockBanner(message) {
  const inject = () => {
    try {
      if (!document.body) return;
      // Hapus banner dev hijau jika ada (kita sekarang blocked).
      const devBanner = document.getElementById('snackzone-dev-banner');
      if (devBanner) devBanner.remove();
      // Hindari banner merah duplikat.
      let b = document.getElementById('snackzone-block-banner');
      if (!b) {
        b = document.createElement('div');
        b.id = 'snackzone-block-banner';
        b.style.cssText = [
          'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:99999',
          'background:#7f1d1d', 'color:#fff', 'padding:12px 16px',
          'font:600 13px/1.4 system-ui,sans-serif', 'text-align:center'
        ].join(';');
        document.body.prepend(b);
      }
      b.textContent = message;
    } catch {}
  };
  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', inject);
    } else {
      inject(); // dokumen sudah siap — jalankan SEKARANG (untuk probe async)
    }
  } catch {
    // fallback: coba langsung
    try { inject(); } catch {}
  }
}

// ── Emulator health probe (async, non-destructive) ──────────────────────────
//  Definitive check: TCP/HTTP reachability ke emulator, BUKAN mengandalkan
//  getDocs (yang bisa return empty saat emulator mati). fetch() ke endpoint
//  emulator akan REJECT (ECONNREFUSED) bila service tidak berjalan.
//  - Firestore: http://127.0.0.1:8080
//  - Auth     : http://127.0.0.1:9099
//  Keduanya HARUS reachable agar mode tetap 'dev'. Jika salah satu gagal →
//  mode dibalik ke blocked, db/auth dinull. TIDAK ada fallback ke produksi.
//
async function verifyEmulatorProbe(_db) {
  const checks = [
    { name: 'Firestore', url: 'http://127.0.0.1:8080/' },
    { name: 'Auth',      url: 'http://127.0.0.1:9099/' },
  ];
  for (const c of checks) {
    try {
      // Abort cepat: cukup pastikan port menjawab (status apa pun).
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3000);
      await fetch(c.url, { method: 'GET', mode: 'no-cors', signal: ctrl.signal });
      clearTimeout(t);
      // reachable (2xx/4xx/5xx semua berarti port terbuka & server menjawab).
    } catch (err) {
      // ECONNREFUSED / abort / network error → emulator DOWN.
      console.error(`[SnackZone] ${c.name} emulator unreachable:`, String(err?.message || err));
      _connectionMode = 'blocked';
      app = null; db = null; auth = null;
      showBlockBanner(
        `SnackZone: ${c.name} Emulator tidak dapat dijangkau ` +
        '(pastikan `firebase emulators:start` berjalan). Aplikasi diblokir.'
      );
      return; // cukup satu kegagalan untuk memblokir seluruh aplikasi
    }
  }
  // Kedua emulator reachable → tetap dev.
}

if (_isLocalhost) {
  // ── DEV: buat app, lalu arahkan KEDUA service ke emulator. ────────────────
  //  Jika SATU SAJA gagal, seluruh mode menjadi blocked (tanpa fallback).
  try {
    const _app  = initializeApp(firebaseConfig);
    const _db   = getFirestore(_app);
    const _auth = getAuth(_app);
    connectFirestoreEmulator(_db, '127.0.0.1', 8080);
    connectAuthEmulator(_auth, 'http://127.0.0.1:9099', { disableWarnings: true });

    // Publikasikan instance; mode dev bersifat PROVISIONAL sampai probe sukses.
    app = _app; db = _db; auth = _auth;
    _connectionMode = 'dev';
    console.info(
      '%c[SnackZone] 🔧 DEV MODE — Terhubung ke Firebase Emulator (data lokal)',
      'color:#39ff14; font-weight:bold;'
    );
    console.info('  Firestore : http://127.0.0.1:8080');
    console.info('  Auth      : http://127.0.0.1:9099');
    console.info('  Data TIDAK dikirim ke Firebase produksi.');

    // ── Verifikasi emulator BENAR-BENAR bisa dijangkau (async) ──────────────
    //  connect*Emulator hanya mengatur endpoint; ia TIDAK membuktikan emulator
    //  sedang berjalan. fetch() ke endpoint emulator memastikan koneksi nyata.
    //  Jika gagal → blocked (instance dinull, tidak fallback ke produksi).
    _ready = verifyEmulatorProbe(_db);
  } catch (err) {
    // connect*Emulator melempar jika dipanggil dua kali (hot reload) —
    // itu BUKAN kegagalan koneksi, jadi jangan blokir.
    if (String(err.message).includes('already been called')) {
      console.warn('[SnackZone] Emulator sudah terhubung (hot reload).');
    } else {
      // Kegagalan nyata → BLOCKED, instance tetap null (tidak fallback).
      console.error('[SnackZone] Gagal menghubungkan emulator:', err);
      _connectionMode = 'blocked';
      app = null; db = null; auth = null;
      showBlockBanner(
        'SnackZone: tidak dapat terhubung ke Firebase Emulator ' +
        '(Firestore 8080 / Auth 9099). Aplikasi diblokir. ' +
        'Jalankan `firebase emulators:start` lalu muat ulang.'
      );
    }
  }
} else if (_isProdHost) {
  // ── PROD: hostname terverifikasi → inisialisasi normal (produksi). ────────
  try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    _connectionMode = 'prod';
    console.info('[SnackZone] Produksi aktif →', _hostname);
  } catch (err) {
    console.error('[SnackZone] Gagal inisialisasi Firebase:', err);
    _connectionMode = 'blocked';
    app = null; db = null; auth = null;
    showBlockBanner('SnackZone: gagal inisialisasi Firebase. Aplikasi diblokir.');
  }
} else {
  // ── BLOCKED: hostname tidak dikenal. TIDAK membuat instance apa pun. ──────
  _connectionMode = 'blocked';
  console.error(
    '[SnackZone] BLOKIR: hostname "%s" tidak dikenali. ' +
    'TIDAK ada koneksi Firebase (produksi maupun emulator) yang dibuat. ' +
    'Gunakan localhost untuk development, atau daftarkan domain ini ke PROD_ALLOWLIST.',
    _hostname
  );
  showBlockBanner(
    'SnackZone: hostname tidak dikenali — koneksi Firebase diblokir. ' +
    'Jalankan via localhost atau gunakan domain produksi yang terdaftar.'
  );
}

// Ekspos mode koneksi (untuk banner + debug).
function getConnectionMode() { return _connectionMode; }
// Promise yang resolve setelah probe emulator selesai (dev) / segera (lainnya).
function whenReady() { return _ready; }

export { app, db, auth, getConnectionMode, whenReady };
