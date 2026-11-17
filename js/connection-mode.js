// ============================================================
//  js/connection-mode.js  —  pure hostname → mode decision
// ============================================================
//
//  Dipecah dari firebase-config.js agar keputusan fail-closed bisa
//  diuji secara unit tanpa browser / Firebase SDK.
//
//  TIDAK ada side-effect. TIDAK menyentuh Firebase. Murni fungsi murni.
//
//  Input : hostname (string, lowercase)
//  Output: 'dev' | 'prod' | 'blocked'
//
//  Aturan:
//    'localhost' | '127.0.0.1'        → 'dev'     (emulator)
//    ada di PROD_ALLOWLIST            → 'prod'    (produksi)
//    lainnya                          → 'blocked' (fail-closed)
// ============================================================

export const PROD_ALLOWLIST = [
  'penjualan-e6360.web.app'   // Firebase Hosting default URL (terverifikasi)
];

export function resolveConnectionMode(hostname) {
  const h = String(hostname || '').toLowerCase().trim();
  if (h === 'localhost' || h === '127.0.0.1') return 'dev';
  if (PROD_ALLOWLIST.includes(h)) return 'prod';
  return 'blocked';
}

// Sama seperti di atas, tapi langsung membaca window.location.hostname.
export function resolveModeFromWindow(loc) {
  let hostname = 'localhost';
  try { hostname = loc.hostname; } catch {}
  return resolveConnectionMode(hostname);
}
