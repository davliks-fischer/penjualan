// ============================================================
//  js/app.js  —  SnackZone Customer Logic  (v3 — normalizePhone + cart snapshot)
//  Handles: Cart, Checkout, Firestore order save, WhatsApp
// ============================================================

import { db, getConnectionMode } from './firebase-config.js';
import {
  collection,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ─── KONSTANTA ───────────────────────────────────────────────────────────────
const WHATSAPP_NUMBER = '6281574958593';
const BLOCKED_MESSAGE =
  'Aplikasi diblokir: koneksi Firebase tidak tersedia (hostname tidak dikenal ' +
  'atau emulator tidak berjalan). Checkout dinonaktifkan.';

// ─── DOUBLE-SUBMIT GUARD ─────────────────────────────────────────────────────
// true saat addDoc sedang berjalan — mencegah klik ganda
let _checkoutInProgress = false;

// ─── STATE KERANJANG ─────────────────────────────────────────────────────────
let cart = JSON.parse(localStorage.getItem('snackzone_cart') || '[]');

// ─── SIMPAN & RENDER ─────────────────────────────────────────────────────────
function saveCart() {
  localStorage.setItem('snackzone_cart', JSON.stringify(cart));
}

function renderCart() {
  const list    = document.getElementById('cart-items-list');
  const empty   = document.getElementById('cart-empty');
  const footer  = document.getElementById('cart-footer');
  const countEl = document.getElementById('cart-count');
  const totalEl = document.getElementById('cart-total-display');

  const totalQty = cart.reduce((s, i) => s + i.qty, 0);
  const totalRp  = cart.reduce((s, i) => s + i.price * i.qty, 0);

  countEl.textContent = totalQty;
  totalQty > 0
    ? countEl.classList.remove('hidden')
    : countEl.classList.add('hidden');

  totalEl.textContent = 'Rp ' + totalRp.toLocaleString('id-ID');

  if (cart.length === 0) {
    list.classList.add('hidden');
    empty.classList.remove('hidden');
    footer.classList.add('hidden');
  } else {
    empty.classList.add('hidden');
    list.classList.remove('hidden');
    footer.classList.remove('hidden');

    list.innerHTML = cart.map(item => `
      <div class="bg-[#111827] border border-gray-800 rounded-xl p-4 flex items-center gap-3 hover:border-[#00f3ff]/40 transition-all">
        <div class="flex-1 min-w-0">
          <p class="text-white font-bold text-sm truncate">${escapeHtml(item.name)}</p>
          <p class="text-[#39ff14] text-sm font-black">Rp ${(item.price * item.qty).toLocaleString('id-ID')}</p>
          <p class="text-gray-600 text-xs">@ Rp ${item.price.toLocaleString('id-ID')}</p>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          <button
            onclick="window.snackZoneUpdateQty('${escapeHtml(item.name)}', -1)"
            class="w-7 h-7 rounded-full border border-gray-700 text-gray-400 hover:border-red-500 hover:text-red-400 transition-all flex items-center justify-center text-lg leading-none">−</button>
          <span class="text-white font-black text-sm w-5 text-center">${item.qty}</span>
          <button
            onclick="window.snackZoneUpdateQty('${escapeHtml(item.name)}', 1)"
            class="w-7 h-7 rounded-full border border-gray-700 text-gray-400 hover:border-[#00f3ff] hover:text-[#00f3ff] transition-all flex items-center justify-center text-lg leading-none">+</button>
        </div>
      </div>
    `).join('');
  }
}

// ─── HELPER: escape HTML ─────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── FUNGSI KERANJANG ─────────────────────────────────────────────────────────
function addToCart(name, price) {
  const existing = cart.find(item => item.name === name);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ name, price, qty: 1 });
  }
  saveCart();
  renderCart();
  openCart();
  flashCartBadge();
}

function updateQty(name, delta) {
  const item = cart.find(i => i.name === name);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) cart = cart.filter(i => i.name !== name);
  saveCart();
  renderCart();
}

function clearCart() {
  cart = [];
  saveCart();
  renderCart();
}

// ─── SIDEBAR ─────────────────────────────────────────────────────────────────
function openCart() {
  document.getElementById('cart-sidebar').classList.add('open');
  document.getElementById('cart-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeCart() {
  document.getElementById('cart-sidebar').classList.remove('open');
  document.getElementById('cart-overlay').classList.add('hidden');
  document.body.style.overflow = '';
}

function flashCartBadge() {
  const badge = document.getElementById('cart-count');
  badge.style.transform = 'scale(1.5)';
  setTimeout(() => { badge.style.transform = 'scale(1)'; }, 200);
}

// ─── KATEGORI ─────────────────────────────────────────────────────────────────
function filterCategory(cat) {
  document.querySelectorAll('.category-btn').forEach(btn => {
    btn.classList.remove('badge-active');
    btn.classList.add('border-gray-700', 'text-gray-400');
  });
  const active = document.querySelector(`[data-cat="${cat}"]`);
  if (active) {
    active.classList.add('badge-active');
    active.classList.remove('border-gray-700', 'text-gray-400');
  }
  document.querySelectorAll('.product-item').forEach(el => {
    el.style.display = (cat === 'semua' || el.dataset.category === cat) ? '' : 'none';
  });
}

// ─── HELPER: normalisasi nomor WA ke format internasional ────────────────────
//
//  Aturan konversi:
//    "08xxx..."  → "628xxx..."   (ganti awalan 0 → 62)
//    "8xxx..."   → "628xxx..."   (tambah 62 di depan)
//    "628xxx..." → "628xxx..."   (sudah benar, pertahankan)
//    "+628..."   → "628..."      (strip tanda +)
//
//  Setelah normalisasi:
//    - Hanya angka (strip semua non-digit)
//    - Panjang 9–15 digit (628XXXXXXXXX minimal 11 untuk nomor Indo)
//    - Harus dimulai dengan 62
//
//  Return: { ok: true, phone: "628xxx" } atau { ok: false, error: "..." }
//
function normalizePhone(raw) {
  if (!raw || typeof raw !== 'string') {
    return { ok: false, error: 'Nomor WhatsApp tidak boleh kosong.' };
  }

  // Strip semua non-digit (spasi, tanda hubung, +, kurung, dll.)
  let digits = raw.replace(/\D/g, '');

  if (digits.length === 0) {
    return { ok: false, error: 'Nomor WhatsApp hanya boleh berisi angka.' };
  }

  // Konversi ke format internasional Indonesia
  if (digits.startsWith('0')) {
    // "08xxx" → "628xxx"
    digits = '62' + digits.slice(1);
  } else if (digits.startsWith('8')) {
    // "8xxx" → "628xxx"
    digits = '62' + digits;
  } else if (!digits.startsWith('62')) {
    // Format tidak dikenali (misal angka dari negara lain)
    return {
      ok: false,
      error: 'Format nomor tidak valid. Gunakan format 08xxx, 8xxx, atau 628xxx.'
    };
  }
  // Jika sudah dimulai dengan "62", biarkan apa adanya

  // Validasi panjang setelah normalisasi
  // Nomor Indonesia: 62 + 8–13 digit = 10–15 total
  if (digits.length < 10 || digits.length > 15) {
    return {
      ok: false,
      error: `Nomor WhatsApp tidak valid (${digits.length} digit setelah normalisasi).`
    };
  }

  return { ok: true, phone: digits };
}
function setCheckoutBtnState(state) {
  // Tombol dipasang via onclick="window.checkout()" di index.html
  const btn = document.getElementById('checkout-btn');
  if (!btn) return;

  if (state === 'loading') {
    btn.disabled = true;
    btn.innerHTML = `
      <svg class="spinner w-5 h-5" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      Menyimpan pesanan...`;
  } else {
    btn.disabled = false;
    btn.innerHTML = `
      <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
      </svg>
      ORDER VIA WHATSAPP`;
  }
}

function showFallbackWALink(url) {
  // Hapus fallback lama jika ada
  const old = document.getElementById('wa-fallback-banner');
  if (old) old.remove();

  const banner = document.createElement('div');
  banner.id = 'wa-fallback-banner';
  banner.className = `
    fixed top-0 left-0 right-0 z-[9999]
    bg-[#0b1120] border-b border-[#25D366]
    p-4 text-sm text-center font-bold
    shadow-[0_4px_20px_rgba(37,211,102,0.3)]
  `;
  banner.innerHTML = `
    <span class="text-gray-300">Browser memblokir popup. </span>
    <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"
       class="text-[#25D366] underline underline-offset-2 hover:text-[#20ba57] transition-colors">
      Klik di sini untuk buka WhatsApp →
    </a>
    <button onclick="document.getElementById('wa-fallback-banner').remove()"
      class="ml-4 text-gray-600 hover:text-white transition-colors text-lg leading-none">×</button>
  `;
  document.body.prepend(banner);

  // Auto-hilang setelah 30 detik
  setTimeout(() => { if (banner.parentNode) banner.remove(); }, 30_000);
}

// ─── CHECKOUT ─────────────────────────────────────────────────────────────────
async function checkout() {
  // ── 0. FAIL-CLOSED: tolak tegas BILA koneksi Firebase tidak tersedia ──
  //     Ketika mode blocked, `db` adalah null dan getConnectionMode() === 'blocked'.
  //     Operasi addDoc TIDAK boleh dijalankan. Guard ini mencegahnya SEBELUM
  //     validasi lain / pembukaan popup / addDoc.
  if (!db || getConnectionMode() === 'blocked') {
    showToast(BLOCKED_MESSAGE, 'error');
    return;
  }

  // ── 1. Guard: cegah double-submit ──────────────────────────
  if (_checkoutInProgress) return;

  // ── 2. Validasi keranjang ───────────────────────────────────
  if (cart.length === 0) {
    showToast('Keranjangmu masih kosong! Tambahkan produk dulu ya 😊', 'warning');
    return;
  }

  // ── 3. Validasi input customer ──────────────────────────────
  const name    = document.getElementById('customer-name').value.trim();
  const address = document.getElementById('customer-address').value.trim();
  const phone   = document.getElementById('customer-phone').value.trim();

  if (!name) {
    showToast('Isi nama kamu dulu ya!', 'warning');
    document.getElementById('customer-name').focus();
    return;
  }
  if (!address) {
    showToast('Isi alamat pengiriman dulu ya!', 'warning');
    document.getElementById('customer-address').focus();
    return;
  }
  if (!phone) {
    showToast('Isi nomor WhatsApp kamu dulu ya!', 'warning');
    document.getElementById('customer-phone').focus();
    return;
  }

  // Normalisasi nomor WA: 08xx→628xx, 8xx→628xx, 62xx→62xx
  const phoneResult = normalizePhone(phone);
  if (!phoneResult.ok) {
    showToast(phoneResult.error, 'warning');
    document.getElementById('customer-phone').focus();
    return;
  }
  const phoneNormalized = phoneResult.phone;

  // ── 4. Snapshot keranjang ───────────────────────────────────
  //
  //  Ambil salinan keranjang SEKARANG, sebelum lock tombol.
  //  Semua kalkulasi (total, payload, pesan WA) menggunakan
  //  snapshot ini — perubahan keranjang oleh tab lain atau
  //  event lain tidak akan mempengaruhi transaksi ini.
  //
  const cartSnapshot = cart.map(i => ({ ...i }));  // deep copy shallow items

  if (cartSnapshot.length === 0) {
    showToast('Keranjang berubah saat proses berlangsung. Silakan coba lagi.', 'warning');
    return;
  }

  // ── 5. Hitung total dari SNAPSHOT ──────────────────────────
  const total      = cartSnapshot.reduce((s, i) => s + i.price * i.qty, 0);
  const totalItems = cartSnapshot.reduce((s, i) => s + i.qty, 0);

  // ── 6. Susun payload dari SNAPSHOT ─────────────────────────
  //    Field harus persis cocok dengan whitelist di firestore.rules
  const orderData = {
    customerName:    name,
    customerAddress: address,
    customerPhone:   phoneNormalized,       // format 62xxxxxxxxx
    items: cartSnapshot.map(i => ({
      name:     i.name,
      price:    i.price,
      qty:      i.qty,
      subtotal: i.price * i.qty
    })),
    totalItems:    totalItems,
    totalAmount:   total,
    status:        'pending',
    paymentStatus: 'unpaid',
    createdAt:     serverTimestamp()        // wajib == request.time di Rules
  };

  // ── 7. Lock tombol + set state loading ─────────────────────
  _checkoutInProgress = true;
  setCheckoutBtnState('loading');

  // ── 8. Buka popup SEBELUM await agar tidak diblokir browser ─
  //    window.open() dipanggil sinkron dalam konteks user gesture.
  //    Tab kosong dibuka dulu; URL diset setelah addDoc berhasil.
  const waWin = window.open('', '_blank');

  // ── 9. Simpan ke Firestore ──────────────────────────────────
  let orderId = null;
  try {
    const docRef = await addDoc(collection(db, 'transactions'), orderData);
    orderId = docRef.id;
  } catch (err) {
    console.error('[Checkout] Gagal menyimpan ke Firestore:', err);

    // Tutup tab kosong yang sudah dibuka
    if (waWin && !waWin.closed) waWin.close();

    // Tampilkan error — JANGAN lanjut ke WA, JANGAN kosongkan keranjang
    showToast(firestoreErrorMessage(err.code), 'error');

    _checkoutInProgress = false;
    setCheckoutBtnState('idle');
    return; // ← HENTIKAN checkout di sini
  }

  // ── 10. Susun pesan WA dari SNAPSHOT (sama dengan payload) ──
  const lines = cartSnapshot.map(i =>
    `  • ${i.name} x${i.qty} = Rp ${(i.price * i.qty).toLocaleString('id-ID')}`
  ).join('\n');

  const message =
`🛒 *PESANAN BARU — SnackZone*
━━━━━━━━━━━━━━━━━━━━━
📋 *Order ID*  : ${orderId}
👤 *Nama*      : ${name}
📱 *WA*        : ${phoneNormalized}
📍 *Alamat*    : ${address}
━━━━━━━━━━━━━━━━━━━━━
📦 *Detail Pesanan:*
${lines}
━━━━━━━━━━━━━━━━━━━━━
💰 *TOTAL      : Rp ${total.toLocaleString('id-ID')}*
━━━━━━━━━━━━━━━━━━━━━
Tolong konfirmasi pesanan saya ya kak! 🙏`;

  const waUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;

  // ── 11. Arahkan tab yang sudah terbuka ke URL WA ───────────
  if (waWin && !waWin.closed) {
    waWin.location.href = waUrl;
  } else {
    showFallbackWALink(waUrl);
  }

  showToast('Pesanan tersimpan! Lanjutkan chat di WhatsApp 💬', 'success');

  // ── 12. Bersihkan state HANYA setelah sukses ───────────────
  clearCart();
  closeCart();
  document.getElementById('customer-name').value    = '';
  document.getElementById('customer-address').value = '';
  document.getElementById('customer-phone').value   = '';

  _checkoutInProgress = false;
  setCheckoutBtnState('idle');
}

// ─── HELPER: pesan error Firestore yang ramah pengguna ───────────────────────
function firestoreErrorMessage(code) {
  const map = {
    'permission-denied':    'Gagal menyimpan pesanan: akses ditolak. Hubungi penjual.',
    'unavailable':          'Koneksi ke server terputus. Periksa internet dan coba lagi.',
    'deadline-exceeded':    'Server terlalu lama merespons. Coba lagi.',
    'resource-exhausted':   'Server sedang sibuk. Coba beberapa saat lagi.',
    'failed-precondition':  'Gagal menyimpan pesanan. Hubungi penjual.',
    'not-found':            'Database tidak ditemukan. Hubungi penjual.',
  };
  return map[code] || 'Gagal menyimpan pesanan. Periksa internet dan coba lagi.';
}

// ─── TOAST NOTIFICATION ───────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const existing = document.getElementById('snack-toast');
  if (existing) existing.remove();

  const colors = {
    success: 'border-[#39ff14] text-[#39ff14] shadow-[0_0_20px_rgba(57,255,20,0.3)]',
    warning: 'border-yellow-400 text-yellow-300 shadow-[0_0_20px_rgba(250,204,21,0.3)]',
    error:   'border-red-500 text-red-400 shadow-[0_0_20px_rgba(239,68,68,0.3)]',
    info:    'border-[#00f3ff] text-[#00f3ff] shadow-[0_0_20px_rgba(0,243,255,0.3)]'
  };

  const toast = document.createElement('div');
  toast.id = 'snack-toast';
  toast.className = `fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999]
    bg-[#0b1120] border rounded-xl px-6 py-3
    font-bold text-sm backdrop-blur-md
    transition-all duration-300 opacity-0 translate-y-4
    max-w-sm text-center
    ${colors[type] || colors.info}`;
  toast.textContent = msg;

  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove('opacity-0', 'translate-y-4');
    toast.classList.add('opacity-100', 'translate-y-0');
  });

  // Error toast bertahan lebih lama
  const duration = type === 'error' ? 6000 : 3500;
  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-4');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ─── EXPOSE GLOBAL ────────────────────────────────────────────────────────────
window.addToCart          = addToCart;
window.snackZoneUpdateQty = updateQty;
window.clearCart          = clearCart;
window.openCart           = openCart;
window.closeCart          = closeCart;
window.checkout           = checkout;
window.filterCategory     = filterCategory;

// ─── INISIALISASI ─────────────────────────────────────────────────────────────
renderCart();
