// ============================================================
//  js/dev-banner.js  —  SnackZone DEV MODE banner
// ============================================================
//
//  Menampilkan badge hijau "DEV MODE — DATA LOKAL" HANYA ketika
//  aplikasi benar-benar terhubung ke Firebase Emulator (probe sukses).
//
//  Status nyata dibaca dari getConnectionMode() + whenReady() di
//  firebase-config.js — BUKAN dari hostname/localStorage. Banner hijau
//  ditunda sampai probe emulator selesai, sehingga tidak ada "DEV MODE"
//  palsu ketika emulator mati (mode akan dibalik ke blocked oleh
//  firebase-config.js + menampilkan banner merah sendiri).
//
//  Cara pakai: load sebagai ES module di halaman, SEBELUM app logic.
//    <script type="module" src="js/dev-banner.js"></script>
// ============================================================

import { getConnectionMode, whenReady } from './firebase-config.js';

async function mount() {
  // Tunggu probe emulator selesai (untuk dev) agar mode final diketahui.
  try { await whenReady(); } catch {}

  if (getConnectionMode() !== 'dev') return; // prod/blocked → tidak ada banner hijau

  const banner = document.createElement('div');
  banner.id = 'snackzone-dev-banner';
  banner.style.cssText = [
    'position:fixed', 'bottom:12px', 'left:12px', 'z-index:99999',
    'background:rgba(6,11,20,0.92)', 'border:1px solid #39ff14',
    'color:#39ff14', 'padding:6px 12px', 'border-radius:8px',
    'font:700 11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace',
    'letter-spacing:0.06em', 'box-shadow:0 0 16px rgba(57,255,20,0.45)',
    'pointer-events:none'
  ].join(';');
  banner.textContent = 'DEV MODE — DATA LOKAL';
  document.body.appendChild(banner);
}

mount();
