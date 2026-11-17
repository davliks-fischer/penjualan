# SnackZone — Panduan Testing Lokal (Firebase Emulator)

Panduan ini menjelaskan cara menjalankan seluruh sistem SnackZone secara **lokal
dan aman**, tanpa menyentuh Firebase produksi.

> ⚠️ **Prinsip keamanan (fail-closed):**
> - `localhost` / `127.0.0.1` → SELALU terhubung ke emulator, tanpa flag.
> - Domain produksi yang terdaftar di `PROD_ALLOWLIST` → koneksi produksi.
> - Hostname lain → app **diblokir** (tidak fallback ke produksi).
>
> Jangan pernah menjalankan `firebase deploy` saat melakukan pengujian.

---

## Pra-syarat

- Node.js 18+ dan `firebase` CLI (login terautentikasi).
- Java 17+ (untuk Cloud Firestore emulator).
- Dependency test sudah terpasang:
  ```bash
  cd test && npm install
  ```

---

## 1. Menjalankan Auth dan Firestore Emulator

Dari root project:

```bash
firebase emulators:start
```

Emulator yang akan berjalan:

| Service    | Port  | URL                          |
|------------|-------|------------------------------|
| Firestore  | 8080  | http://127.0.0.1:8080        |
| Auth       | 9099  | http://127.0.0.1:9099        |
| Emulator UI| 4000  | http://127.0.0.1:4000        |

> Untuk hanya menjalankan Auth + Firestore: `firebase emulators:start --only auth,firestore`

---

## 2. Membuat Akun Admin Emulator

UID admin di-hardcode di `firestore.rules` sebagai
`C1c11Xk6d6WoZySldZ1N4yqDTTy1`. Script `test/scripts/seed-admin.js` membuat akun
Auth Emulator **dengan UID persis tersebut**.

Dari root project (emulator harus sudah berjalan):

```bash
ADMIN_EMAIL=admin@snackzone.test \
ADMIN_PASSWORD=changeme123 \
node test/scripts/seed-admin.js
```

Atau via npm script (dari `test/`):

```bash
npm run seed:admin
```

> Script bersifat idempotent: jika akun dengan UID tsb sudah ada, ia hanya
> memperbarui email/password, tidak membuat duplikat. Password minimal 6 karakter.

---

## 3. Menjalankan Web Server Lokal

Karena aplikasi memakai ES Modules, buka via server HTTP (bukan `file://`).

```bash
python3 -m http.server 8080
```

> Catatan: Firestore Emulator memakai port 8080 juga. Agar tidak bentrok,
> gunakan port web server YANG BERBEDA, misal 5500:
>
> ```bash
> python3 -m http.server 5500
> ```
>
> `firebase.json` mengonfigurasi emulator Firestore di 8080, jadi jangan pakai
> 8080 untuk web server.

---

## 4. Membuka Website Customer dan Admin

- **Customer:** http://127.0.0.1:5500/index.html
- **Admin:**   http://127.0.0.1:5500/admin.html

---

## 5. Memastikan Banner DEV MODE Tampil

Saat dibuka lewat `127.0.0.1`/`localhost`, pojok kiri-bawah halaman akan
menampilkan badge hijau:

```
DEV MODE — DATA LOKAL
```

- Banner muncul **hanya** jika aplikasi benar-benar terhubung ke emulator
  (`getConnectionMode() === 'dev'`).
- Jika emulator tidak berjalan, banner TIDAK muncul (bukan hostname/localStorage
  yang menentukan).
- Di produksi, banner tidak akan pernah muncul.

---

## 6. Melakukan Checkout Percobaan

1. Buka `index.html` (customer).
2. Klik beberapa produk untuk menambah ke keranjang.
3. Isi nama, alamat, dan nomor WhatsApp (contoh `081234567890` — akan
   dinormalisasi ke `6281234567890` oleh `normalizePhone()`).
4. Klik **ORDER VIA WHATSAPP**.
5. Transaksi tersimpan ke **Firestore Emulator** (bukan produksi).

---

## 7. Memeriksa Dokumen Transaksi di Emulator UI

1. Buka http://127.0.0.1:4000 (Emulator UI).
2. Pilih project `penjualan-e6360`.
3. Buka *Firestore* → koleksi `transactions`.
4. Dokumen checkout baru akan tampil dengan status `pending` / `unpaid`.

---

## 8. Login Admin Lokal

1. Buka `admin.html`.
2. Gunakan email/password yang dibuat di langkah 2, misal
   `admin@snackzone.test` / `changeme123`.
3. `admin.js` memverifikasi `user.uid === 'C1c11Xk6d6WoZySldZ1N4yqDTTy1'` —
   akun dari seed script akan lolos.
4. Dashboard akan menampilkan transaksi dari Firestore Emulator.

---

## 9. Konfirmasi Pembayaran & Ubah Status

Di dashboard admin:

- Tekan **KONFIRMASI** untuk `pending` → menyetel `paymentStatus: paid` dan
  `status: processing`.
- Tekan **SELESAI** untuk menyetel `status: completed`.
- Tekan **BATAL** untuk menyetel `status: cancelled`.

Semua operasi ini diizinkan oleh `firestore.rules` untuk admin, dan dicek oleh
40 security rules tests.

---

## 10. Menjalankan Ulang 40 Security Rules Tests

Dari root project:

```bash
firebase emulators:exec --only firestore "cd test && npx mocha --exit rules.spec.js"
```

Atau dari `test/`:

```bash
npm test
```

Harapan hasil: **40 passing, 0 failing**.

Ada juga unit test untuk logika fail-closed (tanpa browser/Firebase):

```bash
cd test && npm run test:connection
```

Harapan hasil: **7 passing** (localhost→dev, 127.0.0.1→dev, web.app→prod,
unknown→blocked, empty→blocked, allowed-only-web.app).

---

## Catatan Keamanan (fail-closed — diperkuat)

Aplikasi memutuskan koneksi secara **fail-closed** SEBELUM membuat instance
Firebase:

- `localhost`/`127.0.0.1` → Firestore 8080 + Auth 9099, lalu **probe ** `fetch`
  untuk memastikan emulator benar-benar hidup. Jika emulator tidak bisa
  dijangkau → mode `blocked`, `db`/`auth` di-null, banner merah muncul,
  checker tidak bisa checkout, admin tidak bisa login/read/update.
- `penjualan-e6360.web.app` (terverifikasi via `firebase hosting:sites:list`)
  → produksi.
- hostname lain → `blocked`; **TIDAK ada instance Firebase yang dibuat**,
  sehingga tidak mungkin ada request ke produksi.
- `*.firebaseapp.com` dan `*.firebasestorage.app` TIDAK masuk allowlist
  (bukan domain Hosting).

Ketika mode `blocked`, `db` dan `auth` diekspor sebagai `null`, dan seluruh
pemanggil (`checkout`, `handleLogin`, `startRealtimeListeners`,
`adminConfirmPayment`, `adminUpdateStatus`, `handleLogout`) memeriksa null
sebelum operasi — jadi tidak ada `addDoc`/`signIn`/`onSnapshot`/`updateDoc`
yang bisa berjalan.

---

## 11. Menghentikan Emulator

Di terminal tempat `firebase emulators:start` berjalan, tekan `Ctrl+C`.

Jika ada proses — emulator yang tertinggal (misal dari sesi sebelumnya yang
aborted) dan port 8080 tersangkut:

```bash
ss -ltnp | grep ':8080'   # cari PID java cloud-firestore-emulator
kill <PID>
```

---

## Catatan Keamanan

- `test/scripts/seed-admin.js` menolak berjalan jika `GOOGLE_APPLICATION_CREDENTIALS`
  diset (untuk mencegah penggunaan service account produksi). Ia memaksa
  `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`.
- Domain produksi yang dikenali (dari `PROD_ALLOWLIST` di `firebase-config.js`):
  `penjualan-e6360.web.app` (terverifikasi via `firebase hosting:sites:list`).
  `*.firebaseapp.com` dan `*.firebasestorage.app` TIDAK masuk allowlist (bukan
  domain Hosting). Jika nanti ada custom domain, tambahkan ke allowlist dulu
  (setelah terverifikasi) sebelum deploy.
