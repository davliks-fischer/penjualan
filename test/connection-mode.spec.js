// ============================================================
//  test/connection-mode.spec.js — fail-closed config unit tests
// ============================================================
//  Verify the PURE decision logic (js/connection-mode.js) that
//  powers firebase-config.js. No browser, no Firebase SDK needed.
//
//  Run:  npx mocha --exit test/connection-mode.spec.js
// ============================================================

const { assert } = require('chai');
const path = require('path');

let resolveConnectionMode;
let PROD_ALLOWLIST;

before(async () => {
  const mod = await import(path.resolve(__dirname, '..', 'js', 'connection-mode.js'));
  resolveConnectionMode = mod.resolveConnectionMode;
  PROD_ALLOWLIST = mod.PROD_ALLOWLIST;
});

describe('connection-mode fail-closed decision', () => {
  it('localhost → dev (emulator)', () => {
    assert.equal(resolveConnectionMode('localhost'), 'dev');
  });

  it('127.0.0.1 → dev (emulator)', () => {
    assert.equal(resolveConnectionMode('127.0.0.1'), 'dev');
  });

  it('UPPERCASE/hostname variants still resolve to dev', () => {
    assert.equal(resolveConnectionMode('LOCALHOST'), 'dev');
    assert.equal(resolveConnectionMode('LocalHost'), 'dev');
  });

  it('penjualan-e6360.web.app → prod', () => {
    assert.equal(resolveConnectionMode('penjualan-e6360.web.app'), 'prod');
  });

  it('unknown hostname → blocked (fail-closed)', () => {
    assert.equal(resolveConnectionMode('192.168.1.10'), 'blocked');
    assert.equal(resolveConnectionMode('evil.example.com'), 'blocked');
    assert.equal(resolveConnectionMode('penjualan-e6360.firebaseapp.com'), 'blocked');
    assert.equal(resolveConnectionMode('penjualan-e6360.firebasestorage.app'), 'blocked');
  });

  it('empty/null hostname → blocked (not dev, not prod)', () => {
    assert.equal(resolveConnectionMode(''), 'blocked');
    assert.equal(resolveConnectionMode(null), 'blocked');
    assert.equal(resolveConnectionMode(undefined), 'blocked');
  });

  it('PROD_ALLOWLIST contains ONLY verified hosting domain', () => {
    assert.deepEqual(PROD_ALLOWLIST, ['penjualan-e6360.web.app']);
  });
});
