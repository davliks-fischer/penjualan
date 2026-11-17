// ============================================================
//  SnackZone Firestore Security Rules — Unit Tests (Emulator)
//  Project: penjualan-e6360
//  Test cases mirror the acceptance criteria from the handoff.
//
//  Run via (from repo root):
//    firebase emulators:exec --only firestore \
//        "mocha --exit test/rules.spec.js"
//
//  Uses @firebase/rules-unit-testing. Each test gets an isolated
//  Firestore instance seeded with the production rules file.
// ============================================================

const { assert } = require('chai');
const fs = require('fs');
const path = require('path');
const { serverTimestamp } = require('firebase/firestore');

const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');

const ADMIN_UID = 'C1c11Xk6d6WoZySldZ1N4yqDTTy1';
const PROJECT_ID = 'penjualan-e6360';

const rulesPath = path.join(__dirname, '..', 'firestore.rules');
const rulesSource = fs.readFileSync(rulesPath, 'utf8');

let testEnv;

// ─── HELPERS ────────────────────────────────────────────────────────────────
function validOrder(overrides = {}) {
  return {
    customerName: 'Budi Santoso',
    customerAddress: 'Jl. Merdeka No. 1, Jakarta',
    customerPhone: '6281234567890',
    items: [
      { name: 'Keripik Setan Level 10', price: 15000, qty: 2, subtotal: 30000 },
    ],
    totalItems: 2,
    totalAmount: 30000,
    status: 'pending',
    paymentStatus: 'unpaid',
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

function dbFor(authContext) {
  // authContext = undefined → unauthenticated context
  // authContext = { sub: '<uid>' } → authenticated; rules read request.auth.uid
  return authContext
    ? testEnv.authenticatedContext(authContext.sub, authContext).firestore()
    : testEnv.unauthenticatedContext().firestore();
}

const UNAUTH = dbFor.bind(null, undefined);

// ─── SETUP / TEARDOWN ───────────────────────────────────────────────────────
before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: rulesSource,
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

after(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

// ─── GROUP 1: CUSTOMER CREATE ──────────────────────────────────────────────
describe('Customer create (unauthenticated)', function () {
  this.timeout(20000);

  it('1. allows valid transaction creation', async () => {
    const db = dbFor(undefined);
    await assertSucceeds(db.collection('transactions').doc().set(validOrder()));
  });

  it('1a. allows phone in canonical 62-prefix format (6281234567890)', async () => {
    const db = dbFor(undefined);
    await assertSucceeds(
      db.collection('transactions').doc().set(validOrder({ customerPhone: '6281234567890' }))
    );
  });

  it('1b. rejects phone without 62 prefix (1234567890)', async () => {
    const db = dbFor(undefined);
    await assertFails(
      db.collection('transactions').doc().set(validOrder({ customerPhone: '1234567890' }))
    );
  });

  it('1c. rejects local 08-prefix phone sent unnormalized (081234567890)', async () => {
    const db = dbFor(undefined);
    await assertFails(
      db.collection('transactions').doc().set(validOrder({ customerPhone: '081234567890' }))
    );
  });

  it('1d. rejects bare 8-prefix phone sent unnormalized (81234567890)', async () => {
    const db = dbFor(undefined);
    await assertFails(
      db.collection('transactions').doc().set(validOrder({ customerPhone: '81234567890' }))
    );
  });

  it('1e. rejects +-prefixed phone sent unnormalized (+6281234567890)', async () => {
    const db = dbFor(undefined);
    await assertFails(
      db.collection('transactions').doc().set(validOrder({ customerPhone: '+6281234567890' }))
    );
  });

  it('2. rejects phone containing letters/symbols', async () => {
    const db = dbFor(undefined);
    await assertFails(
      db.collection('transactions').doc().set(validOrder({ customerPhone: '62812abc4567' }))
    );
  });

  it('3. rejects phone too short (fewer than 10 digits)', async () => {
    const db = dbFor(undefined);
    await assertFails(
      db.collection('transactions').doc().set(validOrder({ customerPhone: '628123456' }))
    );
  });

  it('4. rejects phone too long (more than 15 digits)', async () => {
    const db = dbFor(undefined);
    await assertFails(
      db.collection('transactions').doc().set(validOrder({ customerPhone: '6281234567890123' }))
    );
  });

  it('5. rejects phone with leading + symbol (non-digit)', async () => {
    const db = dbFor(undefined);
    await assertFails(
      db.collection('transactions').doc().set(validOrder({ customerPhone: '+6281234567890' }))
    );
  });

  it('6. rejects status other than pending', async () => {
    const db = dbFor(undefined);
    await assertFails(
      db.collection('transactions').doc().set(validOrder({ status: 'paid' }))
    );
  });

  it('7. rejects paymentStatus other than unpaid', async () => {
    const db = dbFor(undefined);
    await assertFails(
      db.collection('transactions').doc().set(validOrder({ paymentStatus: 'paid' }))
    );
  });

  it('8. rejects extra field not in whitelist', async () => {
    const db = dbFor(undefined);
    await assertFails(
      db.collection('transactions').doc().set(validOrder({ hackerField: 'inject' }))
    );
  });

  it('9. rejects missing required field', async () => {
    const db = dbFor(undefined);
    const o = validOrder();
    delete o.totalAmount;
    await assertFails(db.collection('transactions').doc().set(o));
  });

  it('10. rejects client-supplied non-server createdAt', async () => {
    const db = dbFor(undefined);
    await assertFails(
      db.collection('transactions').doc().set(validOrder({ createdAt: 1234567890 }))
    );
  });

  it('11. rejects empty items list', async () => {
    const db = dbFor(undefined);
    await assertFails(
      db.collection('transactions').doc().set(validOrder({ items: [] }))
    );
  });

  it('12. rejects non-positive totalAmount', async () => {
    const db = dbFor(undefined);
    await assertFails(
      db.collection('transactions').doc().set(validOrder({ totalAmount: 0 }))
    );
  });

  it('13. rejects non-int totalItems (float)', async () => {
    const db = dbFor(undefined);
    await assertFails(
      db.collection('transactions').doc().set(validOrder({ totalItems: 1.5 }))
    );
  });
});

// ─── GROUP 2: CUSTOMER READ / UPDATE / DELETE ──────────────────────────────
describe('Customer read/update/delete (unauthenticated)', function () {
  this.timeout(20000);

  it('14. cannot list transactions', async () => {
    const db = dbFor(undefined);
    await assertFails(db.collection('transactions').get());
  });

  it('15. cannot get a transaction by id', async () => {
    const db = dbFor(undefined);
    await assertFails(db.collection('transactions').doc('any-id').get());
  });

  it('16. cannot update a transaction', async () => {
    const db = dbFor(undefined);
    const ref = db.collection('transactions').doc();
    await assertSucceeds(ref.set(validOrder()));
    await assertFails(ref.update({ status: 'processing' }));
  });

  it('17. cannot delete a transaction', async () => {
    const db = dbFor(undefined);
    await assertFails(db.collection('transactions').doc('any-id').delete());
  });
});

// ─── GROUP 3: AUTH & ADMIN ACCESS ──────────────────────────────────────────
describe('Auth & admin access', function () {
  this.timeout(20000);

  it('18. non-admin authenticated user cannot read transactions', async () => {
    const db = dbFor({ sub: 'some-random-uid' });
    await assertFails(db.collection('transactions').get());
  });

  it('19. admin can list transactions', async () => {
    const seedDb = dbFor(undefined);
    await seedDb.collection('transactions').doc('order-1').set(validOrder());

    const adminDb = dbFor({ sub: ADMIN_UID });
    await assertSucceeds(adminDb.collection('transactions').get());
  });

  it('20. admin can get a transaction by id', async () => {
    const seedDb = dbFor(undefined);
    await seedDb.collection('transactions').doc('order-1').set(validOrder());

    const adminDb = dbFor({ sub: ADMIN_UID });
    await assertSucceeds(adminDb.collection('transactions').doc('order-1').get());
  });
});

// ─── GROUP 4: ADMIN UPDATE ─────────────────────────────────────────────────
describe('Admin update', function () {
  this.timeout(20000);

  async function seedAndReturnAdminDb(orderId = 'order-a') {
    const seedDb = dbFor(undefined);
    await seedDb.collection('transactions').doc(orderId).set(validOrder());
    return dbFor({ sub: ADMIN_UID });
  }

  it('21. admin can update status to processing', async () => {
    const db = await seedAndReturnAdminDb();
    await assertSucceeds(
      db.collection('transactions').doc('order-a').update({ status: 'processing' })
    );
  });

  it('22. admin can update status to completed', async () => {
    const db = await seedAndReturnAdminDb();
    await assertSucceeds(
      db.collection('transactions').doc('order-a').update({ status: 'completed' })
    );
  });

  it('23. admin can update status to cancelled', async () => {
    const db = await seedAndReturnAdminDb();
    await assertSucceeds(
      db.collection('transactions').doc('order-a').update({ status: 'cancelled' })
    );
  });

  it('24. admin can confirm payment (paid + processing)', async () => {
    const db = await seedAndReturnAdminDb();
    await assertSucceeds(
      db.collection('transactions').doc('order-a').update({
        paymentStatus: 'paid',
        status: 'processing',
      })
    );
  });

  it('25. admin can write full audit metadata', async () => {
    const db = await seedAndReturnAdminDb();
    await assertSucceeds(
      db.collection('transactions').doc('order-a').update({
        paymentStatus: 'paid',
        status: 'processing',
        confirmedBy: ADMIN_UID,
        confirmedAt: serverTimestamp(),
        updatedBy: ADMIN_UID,
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('26. admin cannot set invalid status value', async () => {
    const db = await seedAndReturnAdminDb();
    await assertFails(
      db.collection('transactions').doc('order-a').update({ status: 'bogus-value' })
    );
  });

  it('27. admin cannot set invalid paymentStatus value', async () => {
    const db = await seedAndReturnAdminDb();
    await assertFails(
      db.collection('transactions').doc('order-a').update({ paymentStatus: 'weird' })
    );
  });

  it('28. admin cannot change customerName', async () => {
    const db = await seedAndReturnAdminDb();
    await assertFails(
      db.collection('transactions').doc('order-a').update({ customerName: 'Hacker' })
    );
  });

  it('29. admin cannot change customerAddress', async () => {
    const db = await seedAndReturnAdminDb();
    await assertFails(
      db.collection('transactions').doc('order-a').update({ customerAddress: 'X' })
    );
  });

  it('30. admin cannot change customerPhone', async () => {
    const db = await seedAndReturnAdminDb();
    await assertFails(
      db.collection('transactions').doc('order-a').update({ customerPhone: '6289999999999' })
    );
  });

  it('31. admin cannot change items', async () => {
    const db = await seedAndReturnAdminDb();
    await assertFails(
      db.collection('transactions').doc('order-a').update({
        items: [{ name: 'X', price: 1, qty: 1, subtotal: 1 }]
      })
    );
  });

  it('32. admin cannot change totalItems', async () => {
    const db = await seedAndReturnAdminDb();
    await assertFails(
      db.collection('transactions').doc('order-a').update({ totalItems: 999 })
    );
  });

  it('33. admin cannot change totalAmount', async () => {
    const db = await seedAndReturnAdminDb();
    await assertFails(
      db.collection('transactions').doc('order-a').update({ totalAmount: 1 })
    );
  });

  it('34. admin cannot change createdAt', async () => {
    const db = await seedAndReturnAdminDb();
    await assertFails(
      db.collection('transactions').doc('order-a').update({ createdAt: serverTimestamp() })
    );
  });

  it('35. admin cannot add a field outside whitelist', async () => {
    const db = await seedAndReturnAdminDb();
    await assertFails(
      db.collection('transactions').doc('order-a').update({ sideChannel: 'evil' })
    );
  });
});
