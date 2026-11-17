// ============================================================
//  js/admin.js  —  SnackZone Admin Logic  (v3 — final patch)
//  Handles: Auth, Realtime Dashboard, Transaction Management
// ============================================================

import { db, auth, getConnectionMode } from './firebase-config.js';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ─── KONSTANTA ────────────────────────────────────────────────────────────────
const ADMIN_UID = 'C1c11Xk6d6WoZySldZ1N4yqDTTy1';
const TZ        = 'Asia/Jakarta';

// ─── STATE ────────────────────────────────────────────────────────────────────
let unsubscribeOrders = null;
let _activeFilter     = 'semua';

// Cache data pesanan terakhir — dipakai oleh adminViewOrder()
// agar modal bisa menampilkan detail lengkap tanpa query ulang
let _lastOrdersCache  = {};

// ─── AUTH STATE OBSERVER ─────────────────────────────────────────────────────
//  FAIL-CLOSED: hanya pasang observer bila `auth` tersedia (bukan mode blocked).
//  Jika null, langsung tampilkan login screen tanpa operasi Auth/Firestore.
if (auth) {
  onAuthStateChanged(auth, (user) => {
    if (user && user.uid === ADMIN_UID) {
      showDashboard(user);
    } else if (user && user.uid !== ADMIN_UID) {
      adminShowToast('Akun ini tidak memiliki akses admin.', 'error');
      signOut(auth);
      showLoginScreen();
    } else {
      showLoginScreen();
    }
  });
} else {
  // Mode blocked / emulator gagal: jangan pasang observer.
  console.error('[Admin] Firebase tidak tersedia (mode blocked). Login dinonaktifkan.');
}

// ─── TAMPILAN ─────────────────────────────────────────────────────────────────
function hideSplash() {
  const el = document.getElementById('auth-splash');
  if (el) el.classList.add('hidden');
}

function showLoginScreen() {
  hideSplash();
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('dashboard-screen').classList.add('hidden');
  if (unsubscribeOrders) { unsubscribeOrders(); unsubscribeOrders = null; }
  _lastOrdersCache = {};
}

function showDashboard(user) {
  hideSplash();
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('dashboard-screen').classList.remove('hidden');
  const emailEl = document.getElementById('admin-email-display');
  if (emailEl) emailEl.textContent = user.email;
  startRealtimeListeners();
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
async function handleLogin(e) {
  if (e) e.preventDefault();
  const email  = document.getElementById('login-email').value.trim();
  const pass   = document.getElementById('login-password').value;
  const btn    = document.getElementById('login-btn');
  const errEl  = document.getElementById('login-error');

  if (!email || !pass) { showLoginError('Email dan password harus diisi.'); return; }

  // FAIL-CLOSED: jangan menyentuh Auth bila koneksi tidak tersedia.
  if (!auth || getConnectionMode() === 'blocked') {
    showLoginError('Login dinonaktifkan: koneksi Firebase tidak tersedia.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Masuk...';
  if (errEl) errEl.classList.add('hidden');

  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'MASUK';
    showLoginError(authErrorMessage(err.code));
  }
}

function authErrorMessage(code) {
  const map = {
    'auth/invalid-email':          'Format email tidak valid.',
    'auth/user-not-found':         'Akun tidak ditemukan.',
    'auth/wrong-password':         'Password salah.',
    'auth/invalid-credential':     'Email atau password salah.',
    'auth/too-many-requests':      'Terlalu banyak percobaan. Coba lagi nanti.',
    'auth/network-request-failed': 'Koneksi bermasalah. Periksa internet kamu.',
  };
  return map[code] || `Login gagal (${code}). Coba lagi.`;
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  if (el) { el.textContent = msg; el.classList.remove('hidden'); }
}

// ─── LOGOUT ───────────────────────────────────────────────────────────────────
async function handleLogout() {
  if (!confirm('Keluar dari dashboard admin?')) return;
  if (!auth || getConnectionMode() === 'blocked') {
    adminShowToast('Tidak dapat logout: koneksi Firebase tidak tersedia.', 'error');
    return;
  }
  try { await signOut(auth); }
  catch (err) { adminShowToast('Gagal logout: ' + err.message, 'error'); }
}

// ─── REALTIME LISTENER — GUARD LISTENER GANDA ────────────────────────────────
function startRealtimeListeners() {
  if (unsubscribeOrders) { unsubscribeOrders(); unsubscribeOrders = null; }

  // FAIL-CLOSED: jangan pasang onSnapshot bila db tidak tersedia.
  if (!db || getConnectionMode() === 'blocked') {
    console.error('[Admin] Firestore tidak tersedia (mode blocked). Listener tidak dipasang.');
    adminShowToast('Data pesanan tidak tersedia: koneksi Firebase diblokir.', 'error');
    return;
  }

  const q = query(collection(db, 'transactions'), orderBy('createdAt', 'desc'));

  unsubscribeOrders = onSnapshot(q,
    (snapshot) => {
      const orders = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

      // Simpan ke cache untuk modal detail
      _lastOrdersCache = {};
      orders.forEach(o => { _lastOrdersCache[o.id] = o; });

      updateDashboardStats(orders);
      renderOrdersTable(orders);
      applyFilter(_activeFilter);
    },
    (err) => {
      console.error('[Admin] Gagal memuat pesanan:', err);
      adminShowToast('Gagal memuat data pesanan. Periksa koneksi.', 'error');
    }
  );
}

// ─── HELPER: "hari ini" dalam timezone Jakarta ───────────────────────────────
//
//  new Date().setHours(0,0,0,0) menggunakan timezone LOKAL browser.
//  Jika browser dijalankan di luar Jakarta, batas hari akan salah.
//
//  Solusi: bangun string "YYYY-MM-DD 00:00:00" dari bagian lokal Jakarta
//  menggunakan Intl.DateTimeFormat, lalu parse sebagai UTC offset +07:00.
//
function getTodayStartJakarta() {
  const now = new Date();
  // Ambil komponen tanggal dalam timezone Jakarta
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);

  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;

  // "2026-11-14T00:00:00+07:00" → Date object yang tepat
  return new Date(`${y}-${m}-${d}T00:00:00+07:00`);
}

// ─── STATISTIK DASHBOARD ─────────────────────────────────────────────────────
//
//  Definisi yang dipakai:
//  - Pendapatan      : transaksi paymentStatus === 'paid' DAN status !== 'cancelled'
//  - Produk Terjual  : total unit dari transaksi paid + non-cancelled
//  - Pesanan Hari ini: semua status yang masuk sejak 00:00 WIB
//  - Pelanggan Unik  : nomor phone yang sudah dinormalisasi (strip non-digit),
//                      fallback ke customerName jika phone kosong
//
function updateDashboardStats(orders) {
  // Subset transaksi yang dihitung untuk pendapatan & produk
  const paidOrders = orders.filter(
    o => o.paymentStatus === 'paid' && o.status !== 'cancelled'
  );

  // Pendapatan
  const revenue = paidOrders.reduce((s, o) => s + (o.totalAmount || 0), 0);

  // Produk terjual (unit)
  const totalProductsSold = paidOrders.reduce((s, o) => s + (o.totalItems || 0), 0);

  // Pesanan hari ini (semua status, timezone Jakarta)
  const todayStart    = getTodayStartJakarta();
  const todayOrders   = orders.filter(o => {
    if (!o.createdAt) return false;
    const ts = o.createdAt.toDate ? o.createdAt.toDate() : new Date(o.createdAt);
    return ts >= todayStart;
  });

  // Pelanggan unik: normalisasi phone (strip non-digit), fallback ke nama
  const customerKeys = orders.map(o => {
    const phone = (o.customerPhone || '').replace(/\D/g, '');
    if (phone.length >= 9) return phone;                       // pakai phone
    return (o.customerName || '').toLowerCase().trim();        // fallback nama
  }).filter(Boolean);
  const uniqueCustomers = new Set(customerKeys).size;

  // Update stat card DOM
  setStatText('stat-revenue', 'Rp ' + (
    revenue >= 1_000_000
      ? (revenue / 1_000_000).toFixed(1).replace('.', ',') + ' Jt'
      : revenue.toLocaleString('id-ID')
  ));
  setStatText('stat-today-orders',  String(todayOrders.length));
  setStatText('stat-products-sold', String(totalProductsSold));
  setStatText('stat-customers',     String(uniqueCustomers));

  // Badge pesanan pending di navbar
  const pendingCount = orders.filter(o => o.status === 'pending').length;
  const badge = document.getElementById('pending-badge');
  if (badge) {
    badge.textContent = String(pendingCount);
    pendingCount > 0
      ? badge.classList.remove('hidden')
      : badge.classList.add('hidden');
  }
}

function setStatText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// ─── RENDER TABEL PESANAN ─────────────────────────────────────────────────────
function renderOrdersTable(orders) {
  const tbody   = document.getElementById('orders-tbody');
  const empty   = document.getElementById('orders-empty');
  const loading = document.getElementById('orders-loading');
  if (!tbody) return;

  if (loading) loading.classList.add('hidden');

  if (orders.length === 0) {
    tbody.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    return;
  }

  if (empty) empty.classList.add('hidden');

  tbody.innerHTML = orders.slice(0, 50).map(order => {
    const time    = formatTimestamp(order.createdAt);
    const items   = Array.isArray(order.items)
      ? order.items.map(i => `${escapeHtml(i.name)} x${i.qty}`).join(', ')
      : '—';
    const total        = 'Rp ' + (order.totalAmount || 0).toLocaleString('id-ID');
    const statusBadge  = renderStatusBadge(order.status);
    const paymentBadge = renderPaymentBadge(order.paymentStatus);

    const phone = order.customerPhone || '';
    const phoneDisplay = phone
      ? `<a href="https://wa.me/${escapeHtml(phone)}" target="_blank" rel="noopener"
            class="text-[#25D366] hover:underline text-xs font-bold">
           📱 ${escapeHtml(phone)}
         </a>`
      : `<span class="text-gray-700 text-xs">—</span>`;

    return `
    <tr class="order-row border-b border-gray-800/40 transition-colors"
        id="row-${order.id}"
        data-status="${escapeHtml(order.status || 'pending')}">
      <td class="px-4 py-3">
        <p class="text-white font-bold text-sm">${escapeHtml(order.customerName || '—')}</p>
        <p class="text-gray-600 text-xs mt-0.5 max-w-[160px] truncate"
           title="${escapeHtml(order.customerAddress || '')}">${escapeHtml(order.customerAddress || '—')}</p>
        <div class="mt-1">${phoneDisplay}</div>
        <p class="text-gray-700 text-[10px] font-mono mt-0.5">${escapeHtml(order.id.substring(0, 8))}…</p>
      </td>
      <td class="px-4 py-3 text-gray-400 text-sm max-w-[180px] truncate"
          title="${escapeHtml(items)}">${escapeHtml(items)}</td>
      <td class="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">${time}</td>
      <td class="px-4 py-3 text-right font-black text-[#39ff14] text-sm">${total}</td>
      <td class="px-4 py-3 text-center">${statusBadge}</td>
      <td class="px-4 py-3 text-center">${paymentBadge}</td>
      <td class="px-4 py-3 text-center">
        <div class="flex flex-col items-center gap-1.5">
          <button onclick="window.adminViewOrder('${escapeHtml(order.id)}')"
            class="w-full px-2 py-1 text-xs font-bold border border-[#00f3ff]/40 text-[#00f3ff] rounded hover:bg-[#00f3ff]/10 transition-all">
            DETAIL
          </button>
          ${order.status === 'pending' && order.paymentStatus === 'unpaid' ? `
          <button onclick="window.adminConfirmPayment('${escapeHtml(order.id)}')"
            class="w-full px-2 py-1 text-xs font-bold border border-[#39ff14]/40 text-[#39ff14] rounded hover:bg-[#39ff14]/10 transition-all">
            KONFIRMASI
          </button>` : ''}
          ${order.status !== 'completed' && order.status !== 'cancelled' ? `
          <button onclick="window.adminUpdateStatus('${escapeHtml(order.id)}', 'completed')"
            class="w-full px-2 py-1 text-xs font-bold border border-purple-500/40 text-purple-400 rounded hover:bg-purple-500/10 transition-all">
            SELESAI
          </button>` : ''}
          ${order.status !== 'cancelled' ? `
          <button onclick="window.adminUpdateStatus('${escapeHtml(order.id)}', 'cancelled')"
            class="w-full px-2 py-1 text-xs font-bold border border-red-500/30 text-red-400 rounded hover:bg-red-500/10 transition-all">
            BATAL
          </button>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ─── BADGE HELPERS ────────────────────────────────────────────────────────────
function renderStatusBadge(status) {
  const cfg = {
    pending:    { cls: 'badge-pending',   label: 'PENDING' },
    processing: { cls: 'badge-process',   label: 'PROSES'  },
    completed:  { cls: 'badge-success',   label: 'SELESAI' },
    cancelled:  { cls: 'badge-cancelled', label: 'BATAL'   }
  };
  const { cls, label } = cfg[status] || { cls: 'badge-pending', label: (status || '?').toUpperCase() };
  return `<span class="${cls} px-3 py-1 rounded-full text-xs font-bold">${label}</span>`;
}

function renderPaymentBadge(paymentStatus) {
  return paymentStatus === 'paid'
    ? `<span class="badge-success px-3 py-1 rounded-full text-xs font-bold">LUNAS</span>`
    : `<span class="badge-pending px-3 py-1 rounded-full text-xs font-bold">BELUM BAYAR</span>`;
}

// ─── FILTER ───────────────────────────────────────────────────────────────────
function filterOrders(status) {
  _activeFilter = status;
  document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('filter-active'));
  const btn = document.querySelector(`[data-filter="${status}"]`);
  if (btn) btn.classList.add('filter-active');
  applyFilter(status);
}

function applyFilter(status) {
  document.querySelectorAll('#orders-tbody tr').forEach(row => {
    row.style.display = (status === 'semua' || row.dataset.status === status) ? '' : 'none';
  });
}

// ─── MODAL DETAIL ORDER ───────────────────────────────────────────────────────
//
//  Data diambil dari _lastOrdersCache yang diisi oleh onSnapshot.
//  Tidak ada network request tambahan.
//
function adminViewOrder(orderId) {
  const modal = document.getElementById('order-modal');
  if (!modal) return;

  const order = _lastOrdersCache[orderId];
  if (!order) {
    adminShowToast('Data pesanan tidak ditemukan di cache.', 'error');
    return;
  }

  // ── Isi semua field di modal ──────────────────────────────
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val ?? '—';
  };

  set('modal-order-id',      order.id);
  set('modal-customer-name', order.customerName);
  set('modal-customer-phone', order.customerPhone || '—');
  set('modal-customer-address', order.customerAddress);
  set('modal-created-at',    formatTimestamp(order.createdAt));
  set('modal-status',        labelStatus(order.status));
  set('modal-payment',       order.paymentStatus === 'paid' ? '✅ LUNAS' : '⏳ BELUM BAYAR');
  set('modal-total',         'Rp ' + (order.totalAmount || 0).toLocaleString('id-ID'));

  // ── Render daftar item ──────────────────────────────────
  const itemsEl = document.getElementById('modal-items');
  if (itemsEl) {
    if (Array.isArray(order.items) && order.items.length > 0) {
      itemsEl.innerHTML = order.items.map(item => `
        <tr class="border-b border-gray-800/50">
          <td class="py-2 pr-4 text-sm text-gray-300">${escapeHtml(item.name || '—')}</td>
          <td class="py-2 pr-4 text-sm text-gray-400 text-right">
            Rp ${(item.price || 0).toLocaleString('id-ID')}
          </td>
          <td class="py-2 pr-4 text-sm text-gray-400 text-center">${item.qty || 0}</td>
          <td class="py-2 text-sm font-bold text-[#39ff14] text-right">
            Rp ${(item.subtotal || 0).toLocaleString('id-ID')}
          </td>
        </tr>
      `).join('');
    } else {
      itemsEl.innerHTML = `<tr><td colspan="4" class="py-4 text-center text-gray-600">Tidak ada item</td></tr>`;
    }
  }

  // ── Warna status badge di modal ─────────────────────────
  const statusEl = document.getElementById('modal-status');
  if (statusEl) {
    const colorMap = {
      pending:    'text-yellow-400',
      processing: 'text-[#00f3ff]',
      completed:  'text-[#39ff14]',
      cancelled:  'text-red-400'
    };
    statusEl.className = `font-bold text-sm ${colorMap[order.status] || 'text-gray-400'}`;
  }

  modal.classList.remove('hidden');
}

function labelStatus(status) {
  const m = { pending: 'PENDING', processing: 'PROSES', completed: 'SELESAI', cancelled: 'BATAL' };
  return m[status] || (status || '—').toUpperCase();
}

// ─── KONFIRMASI & UPDATE STATUS ───────────────────────────────────────────────
async function adminConfirmPayment(orderId) {
  if (!confirm('Konfirmasi pembayaran untuk pesanan ini?\n\n⚠️ Pastikan kamu sudah memeriksa detail dan harga sebelum konfirmasi.')) return;
  if (!db || getConnectionMode() === 'blocked') {
    adminShowToast('Konfirmasi dibatalkan: koneksi Firebase tidak tersedia.', 'error');
    return;
  }
  try {
    await updateDoc(doc(db, 'transactions', orderId), {
      paymentStatus: 'paid',
      status:        'processing',
      confirmedAt:   serverTimestamp(),
      confirmedBy:   ADMIN_UID
    });
    adminShowToast('✅ Pembayaran dikonfirmasi! Status → PROSES', 'success');
  } catch (err) {
    console.error('[Admin] Gagal konfirmasi:', err);
    adminShowToast('Gagal konfirmasi: ' + err.message, 'error');
  }
}

async function adminUpdateStatus(orderId, newStatus) {
  const valid = ['pending', 'processing', 'completed', 'cancelled'];
  if (!valid.includes(newStatus)) { adminShowToast('Status tidak valid.', 'error'); return; }
  if (!db || getConnectionMode() === 'blocked') {
    adminShowToast('Update status dibatalkan: koneksi Firebase tidak tersedia.', 'error');
    return;
  }
  try {
    const data = { status: newStatus, updatedAt: serverTimestamp(), updatedBy: ADMIN_UID };
    if (newStatus === 'completed') data.completedAt = serverTimestamp();
    if (newStatus === 'cancelled') data.cancelledAt = serverTimestamp();
    await updateDoc(doc(db, 'transactions', orderId), data);
    adminShowToast(`Status → ${newStatus.toUpperCase()}`, 'success');
  } catch (err) {
    console.error('[Admin] Gagal update status:', err);
    adminShowToast('Gagal update: ' + err.message, 'error');
  }
}

// ─── UTILITAS ─────────────────────────────────────────────────────────────────
function formatTimestamp(ts) {
  if (!ts) return '—';
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(date.getTime())) return '—';
  // Format dalam timezone Jakarta
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: TZ,
    weekday: 'short',
    day:     '2-digit',
    month:   '2-digit',
    year:    'numeric',
    hour:    '2-digit',
    minute:  '2-digit',
    hour12:  false
  }).format(date).replace(',', '');
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function adminShowToast(msg, type = 'info') {
  const old = document.getElementById('admin-toast');
  if (old) old.remove();

  const colors = {
    success: 'border-[#39ff14] text-[#39ff14] shadow-[0_0_20px_rgba(57,255,20,0.3)]',
    warning: 'border-yellow-400 text-yellow-300 shadow-[0_0_20px_rgba(250,204,21,0.3)]',
    error:   'border-red-500 text-red-400 shadow-[0_0_20px_rgba(239,68,68,0.3)]',
    info:    'border-[#00f3ff] text-[#00f3ff] shadow-[0_0_20px_rgba(0,243,255,0.3)]'
  };

  const toast = document.createElement('div');
  toast.id = 'admin-toast';
  toast.className = `fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999]
    bg-[#0b1120] border rounded-xl px-6 py-3
    font-bold text-sm backdrop-blur-md max-w-sm text-center
    transition-all duration-300 opacity-0 translate-y-4
    ${colors[type] || colors.info}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.remove('opacity-0', 'translate-y-4');
    toast.classList.add('opacity-100', 'translate-y-0');
  });
  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-4');
    setTimeout(() => toast.remove(), 300);
  }, type === 'error' ? 6000 : 4000);
}

function updateHeaderDate() {
  const el = document.getElementById('tanggal-header');
  if (!el) return;
  const hari  = ['MINGGU','SENIN','SELASA','RABU','KAMIS','JUMAT','SABTU'];
  const bulan = ['JAN','FEB','MAR','APR','MEI','JUN','JUL','AGS','SEP','OKT','NOV','DES'];
  const now   = new Date();
  el.textContent = `${hari[now.getDay()]}, ${now.getDate()} ${bulan[now.getMonth()]} ${now.getFullYear()}`;
}

// ─── EXPOSE GLOBAL ────────────────────────────────────────────────────────────
window.handleLogin          = handleLogin;
window.handleLogout         = handleLogout;
window.adminConfirmPayment  = adminConfirmPayment;
window.adminUpdateStatus    = adminUpdateStatus;
window.adminViewOrder       = adminViewOrder;
window.filterOrders         = filterOrders;

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  updateHeaderDate();

  const form = document.getElementById('login-form');
  if (form) form.addEventListener('submit', handleLogin);

  const togglePw = document.getElementById('toggle-password');
  const pwInput  = document.getElementById('login-password');
  if (togglePw && pwInput) {
    togglePw.addEventListener('click', () => {
      pwInput.type = pwInput.type === 'password' ? 'text' : 'password';
    });
  }

  document.getElementById('close-modal')?.addEventListener('click', () => {
    document.getElementById('order-modal')?.classList.add('hidden');
  });

  // Tutup modal jika klik di luar konten
  document.getElementById('order-modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
  });
});
