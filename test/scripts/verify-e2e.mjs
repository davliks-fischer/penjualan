// ============================================================
//  test/scripts/verify-e2e.mjs — end-to-end emulator verification
// ============================================================
//  Verifies (against LIVE emulators):
//   1. Admin login via Auth Emulator returns the rules-matching UID.
//   2. Admin (that UID) can READ transactions in Firestore Emulator.
//   3. Admin can UPDATE a transaction (confirm payment) — rules allow.
//   4. Unauthenticated cannot read transactions.
//
//  Run while `firebase emulators:start --only auth,firestore` is up.
// ============================================================

import { initializeApp } from 'firebase/app';
import {
  getFirestore, connectFirestoreEmulator,
  collection, addDoc, getDocs, doc, updateDoc, serverTimestamp
} from 'firebase/firestore';
import {
  getAuth, connectAuthEmulator, signInWithEmailAndPassword
} from 'firebase/auth';

const ADMIN_UID = 'C1c11Xk6d6WoZySldZ1N4yqDTTy1';

const app = initializeApp({
  projectId: 'penjualan-e6360',
  apiKey: 'fake-api-key',
  authDomain: 'penjualan-e6360.firebaseapp.com',
});

const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });

const results = [];
function check(name, cond) {
  results.push([name, !!cond]);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
}

// 1. Seed a transaction as unauthenticated (customer create is allowed)
const order = {
  customerName: 'E2E Test',
  customerAddress: 'Jl. Test',
  customerPhone: '6281234567890',
  items: [{ name: 'Test Item', price: 10000, qty: 1, subtotal: 10000 }],
  totalItems: 1,
  totalAmount: 10000,
  status: 'pending',
  paymentStatus: 'unpaid',
  createdAt: serverTimestamp(),
};
const docRef = await addDoc(collection(db, 'transactions'), order);
console.log('Seeded order id:', docRef.id);

// 2. Unauthenticated read should be DENIED (rules: list only admin)
try {
  await getDocs(collection(db, 'transactions'));
  check('unauth cannot list transactions (should be denied)', false);
} catch (e) {
  check('unauth cannot list transactions (should be denied)', /permission|denied/i.test(String(e)));
}

// 3. Login as admin via Auth Emulator
const cred = await signInWithEmailAndPassword(auth, 'admin@snackzone.test', 'changeme123');
const uid = cred.user.uid;
check(`admin login returns rules-matching UID (${uid})`, uid === ADMIN_UID);

// 4. Admin can list transactions
try {
  const snap = await getDocs(collection(db, 'transactions'));
  check('admin can list transactions', !snap.empty);
} catch (e) {
  check('admin can list transactions', false);
}

// 5. Admin can update (confirm payment)
try {
  await updateDoc(doc(db, 'transactions', docRef.id), {
    status: 'processing',
    paymentStatus: 'paid',
    confirmedBy: ADMIN_UID,
    confirmedAt: serverTimestamp(),
  });
  check('admin can confirm payment (update)', true);
} catch (e) {
  check('admin can confirm payment (update)', false);
}

// Summary
const failed = results.filter(([, c]) => !c).length;
console.log(`\n=== E2E RESULT: ${results.length - failed}/${results.length} PASS ===`);
process.exit(failed === 0 ? 0 : 1);
