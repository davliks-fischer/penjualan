#!/usr/bin/env node
// ============================================================
//  scripts/seed-admin.js — SnackZone Auth Emulator admin seed
// ============================================================
//
//  Membuat akun admin LOKAL di Firebase Authentication EMULATOR
//  dengan UID yang persis cocok dengan firestore.rules.
//
//  UID admin (hardcoded di firestore.rules):
//    C1c11Xk6d6WoZySldZ1N4yqDTTy1
//
//  KEAMANAN:
//  - Script ini TIDAK akan pernah menyentuh Firebase Auth produksi.
//    Ia memaksa FIREBASE_AUTH_EMULATOR_HOST, sehingga Admin SDK hanya
//    berbicara ke emulator lokal. Tanpa env tersebut, script berhenti.
//  - Email & password diambil dari environment variable, BUKAN
//    hardcoded di source code.
//  - Tidak menggunakan service account produksi.
//
//  CARA PAKAI (jalankan dari repo root):
//    cd "$(git rev-parse --show-toplevel)"
//    firebase emulators:start --only auth,firestore &
//    # tunggu emulator siap, lalu:
//    ADMIN_EMAIL=admin@snackzone.test \
//    ADMIN_PASSWORD=changeme123 \
//    node test/scripts/seed-admin.js
//
//  Jika akun dengan UID tsb sudah ada, script memperbarui email/password
//  (idempotent) alih-alih membuat duplikat.
// ============================================================

// ⚠️ HARUS sebelum import firebase-admin → memaksa koneksi ke emulator.
if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
}
// Ganda pengaman: pastikan tidak ada service account produksi yang dipakai.
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error(
    '[seed-admin] ERROR: GOOGLE_APPLICATION_CREDENTIALS terdeteksi. ' +
    'Script ini hanya untuk Auth Emulator dan menolak menggunakan ' +
    'service account kredensial (risiko menyentuh produksi). Unset env ' +
    'tersebut lalu coba lagi.'
  );
  process.exit(1);
}

const { getAuth } = require('firebase-admin/auth');
const { initializeApp, applicationDefault } = require('firebase-admin/app');

const PROJECT_ID  = 'penjualan-e6360';
const ADMIN_UID   = 'C1c11Xk6d6WoZySldZ1N4yqDTTy1';
const EMAIL       = process.env.ADMIN_EMAIL;
const PASSWORD    = process.env.ADMIN_PASSWORD;
const EMULATOR    =
  process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

// ── Validasi input ──────────────────────────────────────────────────────────
if (!EMAIL || !PASSWORD) {
  console.error(
    '[seed-admin] ERROR: ADMIN_EMAIL dan ADMIN_PASSWORD wajib di-set.\n' +
    '  Contoh:\n' +
    '  ADMIN_EMAIL=admin@snackzone.test ADMIN_PASSWORD=changeme123 \\\n' +
    '    node test/scripts/seed-admin.js'
  );
  process.exit(1);
}
if (PASSWORD.length < 6) {
  console.error('[seed-admin] ERROR: Password minimal 6 karakter (Auth Emulator requirement).');
  process.exit(1);
}

// ── Init Admin SDK (projectId saja; auth diarahkan ke emulator) ────────────
const app = initializeApp({ projectId: PROJECT_ID });
const auth = getAuth(app);

// ── Jalankan ────────────────────────────────────────────────────────────────
(async () => {
  console.log(`[seed-admin] Target: Auth Emulator @ ${EMULATOR}`);
  console.log(`[seed-admin] Project: ${PROJECT_ID}`);
  console.log(`[seed-admin] UID admin: ${ADMIN_UID}`);
  console.log(`[seed-admin] Email   : ${EMAIL}`);

  try {
    let created = false;

    // Cek apakah akun dengan UID tsb sudah ada.
    try {
      const existing = await auth.getUser(ADMIN_UID);
      // Sudah ada → update email/password agar deterministik (idempotent).
      await auth.updateUser(ADMIN_UID, {
        email: EMAIL,
        emailVerified: true,
        password: PASSWORD,
      });
      console.log(`[seed-admin] Akun SUDAH ADA (uid=${ADMIN_UID}); email/password diperbarui.`);
      console.log(`[seed-admin] Email sebelumnya: ${existing.email}`);
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        // Buat baru DENGAN UID eksplisit yang cocok rules.
        await auth.createUser({
          uid: ADMIN_UID,
          email: EMAIL,
          emailVerified: true,
          password: PASSWORD,
        });
        created = true;
        console.log(`[seed-admin] Akun admin BARU dibuat dengan UID eksplisit.`);
      } else {
        throw err;
      }
    }

    // Verifikasi: baca kembali untuk memastikan UID & email benar.
    const fresh = await auth.getUser(ADMIN_UID);
    if (fresh.uid !== ADMIN_UID) {
      throw new Error(`UID mismatch: ${fresh.uid} !== ${ADMIN_UID}`);
    }

    console.log('[seed-admin] ──────────────────────────────────────────');
    console.log('[seed-admin] ✅ BERHASIL');
    console.log(`[seed-admin]   UID   : ${fresh.uid}`);
    console.log(`[seed-admin]   Email : ${fresh.email}`);
    console.log(`[seed-admin]   Verified: ${fresh.emailVerified}`);
    console.log(`[seed-admin]   Status: ${created ? 'dibuat baru' : 'diupdate'}`);
    console.log('[seed-admin] ──────────────────────────────────────────');
    console.log('[seed-admin] Akun ini sekarang dapat login di admin.html');
    console.log('[seed-admin] (buka http://localhost:8080/admin.html saat emulator aktif).');
  } catch (err) {
    // Auth Emulator tidak aktif → error koneksi yang jelas.
    if (err.code === 'ECONNREFUSED' || /emulator/i.test(String(err.message))) {
      console.error(
        '[seed-admin] GAGAL: Tidak bisa terhubung ke Auth Emulator di ' +
        `${EMULATOR}.\n` +
        '  Pastikan emulator berjalan: firebase emulators:start --only auth,firestore'
      );
    } else {
      console.error('[seed-admin] GAGAL:', err.code || '', err.message);
    }
    process.exit(1);
  } finally {
    // Bersihkan app (opsional; proses akan exit).
  }
})();
