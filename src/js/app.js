import { auth, googleWebClientId } from "./firebase-init.js";
import { watchAuth, signOutUser, currentUser } from "./auth.js";
import { subscribe, writeProducts, writeLogs, writeSettings, migrateLocalGuestData, guestLocal } from "./data-store.js";

const LOGO_SVG = `
<svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="2" y="9" width="16" height="16" rx="6" transform="rotate(-20 2 9)" stroke="#D4AF6A" stroke-width="2.4"/>
  <rect x="10" y="5" width="16" height="16" rx="6" transform="rotate(-20 10 5)" stroke="currentColor" stroke-width="2.4" fill="none"/>
</svg>`;

const CATEGORIES = { 'Home & Kitchen': '#4FAE8D', 'Beauty': '#E2685A', 'Electronics': '#6C8FC7', 'Fashion': '#A87FC9', 'Fitness': '#D4AF6A', 'Other': '#9BA0AB' };
const PLATFORMS = { Amazon: { param: 'tag' }, Flipkart: { param: 'affid' }, Other: { param: 'ref' } };
const CURRENCIES = ['USD', 'INR', 'AED'];
const CURRENCY_META = {
  USD: { symbol: '$', label: 'US Dollar' },
  INR: { symbol: '₹', label: 'Indian Rupee' },
  AED: { symbol: 'AED', label: 'Dubai Dirham' },
};
const FALLBACK_RATES = { USD: 1, INR: 85, AED: 3.67 };
const RATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let settings = { tags: { Amazon: '', Flipkart: '', Other: '' }, displayCurrency: 'USD', theme: 'dark', name: '' };
let products = [];
let logs = [];
let rateState = { rates: FALLBACK_RATES, fetchedAt: 0, source: 'fallback', error: null };
let showSettings = false;
let settingsTab = 'profile';
let addMode = null;
let expandedQR = new Set();
let searchTerm = '';
let filterCategory = 'All';
let sortMode = 'newest';
let ratesLoading = false;

let user = null;
let unsubProducts = null, unsubLogs = null, unsubSettings = null;
let syncing = false;

const root = document.getElementById('root');

// ---------- auth gate ----------
watchAuth(async (u) => {
  user = u;
  const loginGate = document.getElementById('login-gate');
  const appShell = document.getElementById('app-shell');
  if (!user) {
    if (unsubProducts) unsubProducts(); if (unsubLogs) unsubLogs(); if (unsubSettings) unsubSettings();
    loginGate.style.display = '';
    appShell.style.display = 'none';
    window.location.href = './login.html';
    return;
  }
  loginGate.style.display = 'none';
  appShell.style.display = '';
  await migrateLocalGuestData(user.uid);
  bindCloudSync();
  await loadRates(false);
  render();
});

function bindCloudSync() {
  if (unsubProducts) unsubProducts();
  if (unsubLogs) unsubLogs();
  if (unsubSettings) unsubSettings();

  unsubProducts = subscribe(user.uid, 'products', (data) => {
    products = (data && data.items) || [];
    render();
  });
  unsubLogs = subscribe(user.uid, 'logs', (data) => {
    logs = ((data && data.items) || []).map(e => ({ currency: 'USD', ...e }));
    render();
  });
  unsubSettings = subscribe(user.uid, 'settings', (data) => {
    if (data) settings = { tags: { Amazon: '', Flipkart: '', Other: '' }, displayCurrency: 'USD', theme: 'dark', name: '', ...data };
    document.documentElement.setAttribute('data-theme', settings.theme || 'dark');
    render();
  });
}

async function saveSettings() { syncing = true; await writeSettings(user.uid, settings); syncing = false; }
async function saveProducts() { syncing = true; await writeProducts(user.uid, products); syncing = false; }
async function saveLogs() { syncing = true; await writeLogs(user.uid, logs); syncing = false; }

// ---------- helpers ----------
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1600);
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function copyText(text, label) {
  navigator.clipboard.writeText(text).then(() => toast(`${label} copied`)).catch(() => toast('Could not copy'));
}

function extractAsin(url) {
  const patterns = [/\/dp\/([A-Z0-9]{10})/i, /\/gp\/product\/([A-Z0-9]{10})/i, /\/product\/([A-Z0-9]{10})/i, /[?&]asin=([A-Z0-9]{10})/i];
  for (const p of patterns) { const m = url.match(p); if (m) return m[1].toUpperCase(); }
  return null;
}

function buildAffiliateLink(rawUrl, platform) {
  const tag = settings.tags[platform] || '';
  if (platform === 'Amazon') {
    const asin = extractAsin(rawUrl);
    const domainMatch = rawUrl.match(/https?:\/\/(?:www\.)?(amazon\.[a-z.]+)/i);
    const domain = domainMatch ? domainMatch[1] : 'amazon.com';
    if (asin) {
      const base = `https://www.${domain}/dp/${asin}/`;
      return tag ? `${base}?tag=${encodeURIComponent(tag)}` : base;
    }
  }
  if (!tag) return rawUrl;
  const param = PLATFORMS[platform]?.param || 'ref';
  const sep = rawUrl.includes('?') ? '&' : '?';
  return `${rawUrl}${sep}${param}=${encodeURIComponent(tag)}`;
}

function buildCaption(name, link) {
  return `✨ Just found this and had to share!\n\n${name}\n\n👉 Grab it here: ${link}\n\n#ad #affiliatelink`;
}

function convert(amount, fromCurrency, toCurrency) {
  const rates = rateState.rates || FALLBACK_RATES;
  const fromRate = rates[fromCurrency] || FALLBACK_RATES[fromCurrency] || 1;
  const toRate = rates[toCurrency] || FALLBACK_RATES[toCurrency] || 1;
  const usdAmount = amount / fromRate;
  return usdAmount * toRate;
}

function formatCurrency(amount, currency) {
  if (amount == null || isNaN(amount)) amount = 0;
  if (currency === 'USD') return '$' + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (currency === 'INR') return '₹' + amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (currency === 'AED') return 'AED ' + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return amount.toFixed(2) + ' ' + currency;
}

async function loadRates(force) {
  try {
    const cached = guestLocal.get('rates_v1', null);
    if (cached) rateState = { ...rateState, ...cached, error: null };
  } catch (e) {}

  const age = Date.now() - (rateState.fetchedAt || 0);
  if (!force && rateState.fetchedAt && age < RATE_MAX_AGE_MS) return;

  ratesLoading = true;
  try {
    const resp = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!resp.ok) throw new Error('Rate API returned ' + resp.status);
    const data = await resp.json();
    if (data.result !== 'success' || !data.rates) throw new Error('Malformed rate response');
    const rates = { USD: 1 };
    CURRENCIES.forEach(c => { if (data.rates[c]) rates[c] = data.rates[c]; });
    rateState = { rates: { ...FALLBACK_RATES, ...rates }, fetchedAt: Date.now(), source: 'live', error: null };
    guestLocal.set('rates_v1', rateState);
  } catch (e) {
    if (!rateState.rates) rateState.rates = FALLBACK_RATES;
    rateState.error = e.message || 'Could not reach exchange-rate service';
    if (rateState.source !== 'live') rateState.source = 'fallback';
  } finally {
    ratesLoading = false;
  }
}

function hasAnyTag() { return Object.values(settings.tags).some(v => v && v.trim()); }
function logConverted(log) { return convert(log.originalAmount, log.currency, settings.displayCurrency); }
function productEarningsConverted(productId) { return logs.filter(l => l.productId === productId).reduce((s, l) => s + logConverted(l), 0); }
function todayStr() { return new Date().toISOString().slice(0, 10); }
function monthStr(d) { return (d || todayStr()).slice(0, 7); }
function prevMonthStr() { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); }

function exportCSV() {
  let rows = [['Type','Name','Category','Platform','Link','Date','Network','OriginalAmount','OriginalCurrency','ConvertedAmount','DisplayCurrency','Clicks','Orders']];
  products.forEach(p => rows.push(['Product', p.name, p.category, p.platform, p.link, '', '', '', '', '', '', '', '']));
  logs.forEach(l => rows.push(['Log', l.productName, '', '', '', l.date, l.network || l.productName, l.originalAmount, l.currency, logConverted(l).toFixed(2), settings.displayCurrency, l.clicks, l.orders]));
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'affilio-export.csv';
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV exported');
}

function exportJSON() {
  const payload = { exportedAt: new Date().toISOString(), settings, products, logs };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'affilio-backup.json';
  a.click();
  URL.revokeObjectURL(url);
  toast('JSON backup exported');
}

// ---------- render ----------
function render() {
  const disp = settings.displayCurrency;
  const today = todayStr();
  const thisMonth = monthStr();
  const lastMonth = prevMonthStr();

  const todayEarnings = logs.filter(l => l.date === today).reduce((s, l) => s + logConverted(l), 0);
  const monthEarnings = logs.filter(l => monthStr(l.date) === thisMonth).reduce((s, l) => s + logConverted(l), 0);
  const lifetimeEarnings = logs.reduce((s, l) => s + logConverted(l), 0);
  const lastMonthEarnings = logs.filter(l => monthStr(l.date) === lastMonth).reduce((s, l) => s + logConverted(l), 0);

  const byNetwork = {};
  logs.forEach(l => { const key = l.network || 'Other'; byNetwork[key] = (byNetwork[key] || 0) + logConverted(l); });
  const networkEntries = Object.entries(byNetwork).sort((a, b) => b[1] - a[1]);
  const bestNetwork = networkEntries[0];

  const byCurrency = {};
  logs.forEach(l => { byCurrency[l.currency] = (byCurrency[l.currency] || 0) + l.originalAmount; });

  const growthPct = lastMonthEarnings > 0 ? ((monthEarnings - lastMonthEarnings) / lastMonthEarnings) * 100 : (monthEarnings > 0 ? 100 : 0);

  const onboardSteps = [
    { done: hasAnyTag(), label: 'Add your affiliate tracking ID' },
    { done: products.length > 0, label: 'Create your first affiliate link' },
    { done: logs.length > 0, label: 'Log your first click/earning' },
  ];
  const onboardComplete = onboardSteps.every(s => s.done);

  let visibleProducts = products.filter(p => (filterCategory === 'All' || p.category === filterCategory) && p.name.toLowerCase().includes(searchTerm.toLowerCase()));
  if (sortMode === 'newest') visibleProducts.sort((a,b) => b.createdAt - a.createdAt);
  if (sortMode === 'earnings') visibleProducts.sort((a,b) => productEarningsConverted(b.id) - productEarningsConverted(a.id));

  const topProduct = products.slice().sort((a,b) => productEarningsConverted(b.id) - productEarningsConverted(a.id))[0];
  const recentLogs = logs.slice(-8);
  const maxCommission = Math.max(1, ...recentLogs.map(l => logConverted(l)));

  const rateAgeHrs = rateState.fetchedAt ? Math.round((Date.now() - rateState.fetchedAt) / 3600000) : null;
  const rateStale = rateState.source !== 'live' || rateState.error;

  root.innerHTML = `
    <div class="brand-row">
      <div class="brand">${LOGO_SVG}<h1>Affil<em>io</em></h1></div>
      <div style="display:flex;gap:8px;">
        <button class="icon-btn" id="toggle-theme" title="Toggle theme" aria-label="Toggle theme">${settings.theme === 'light' ? '🌙' : '☀️'}</button>
        <button class="icon-btn" id="export-csv" title="Export CSV" aria-label="Export CSV">⬇</button>
        <button class="icon-btn" id="toggle-settings" aria-label="Settings">⚙</button>
      </div>
    </div>
    <p class="tagline">Track. Share. <em>Earn.</em>${syncing ? ' <span style="color:var(--muted)">· syncing…</span>' : ''}</p>

    <div class="rate-banner ${rateStale ? 'stale' : ''}">
      <span>${ratesLoading ? 'Updating exchange rates…' : rateState.error ? `Live rates unavailable — using ${rateState.source === 'live' ? 'last cached' : 'offline fallback'} rates${rateAgeHrs != null ? ` (${rateAgeHrs}h old)` : ''}.` : `Rates updated ${rateAgeHrs === 0 ? 'less than an hour ago' : rateAgeHrs + 'h ago'} · 1 USD = ${(rateState.rates.INR||FALLBACK_RATES.INR).toFixed(2)} INR = ${(rateState.rates.AED||FALLBACK_RATES.AED).toFixed(2)} AED`}</span>
      <button id="refresh-rates">Refresh</button>
    </div>

    ${onboardComplete ? `
      <div class="onboard complete"><p>✓ You're fully set up</p><span style="color:var(--muted);font-size:12px;">Keep creating links →</span></div>
    ` : `
      <div class="onboard">
        <h3>Getting started</h3>
        ${onboardSteps.map(s => `<div class="step ${s.done ? 'done' : ''}"><span class="mark">${s.done ? '✓' : ''}</span><span class="label">${s.label}</span></div>`).join('')}
      </div>
    `}

    ${showSettings ? renderSettings() : ''}

    <div class="section-head"><h2>Dashboard</h2></div>
    <div class="curr-select-row">
      <label>Display currency</label>
      <div class="curr-pills">
        ${CURRENCIES.map(c => `<button class="curr-pill ${c === disp ? 'active' : ''}" data-curr="${c}">${CURRENCY_META[c].symbol} ${c}</button>`).join('')}
      </div>
    </div>
    <div class="stat-strip">
      <div class="stat"><div class="n">${formatCurrency(todayEarnings, disp)}</div><div class="l">Today</div></div>
      <div class="stat"><div class="n">${formatCurrency(monthEarnings, disp)}</div><div class="l">This month</div></div>
      <div class="stat"><div class="n">${formatCurrency(lifetimeEarnings, disp)}</div><div class="l">Lifetime</div></div>
      <div class="stat"><div class="n">${networkEntries.length}</div><div class="l">Networks</div></div>
    </div>

    <div class="analytics-grid">
      <div class="a-card">
        <div class="a-label">Best-performing network</div>
        <div class="a-val">${bestNetwork ? escapeHTML(bestNetwork[0]) : '—'}</div>
        <div class="a-sub">${bestNetwork ? formatCurrency(bestNetwork[1], disp) + ' lifetime' : 'No earnings logged yet'}</div>
      </div>
      <div class="a-card">
        <div class="a-label">Monthly growth</div>
        <div class="a-val ${growthPct >= 0 ? 'up' : 'down'}">${growthPct >= 0 ? '▲' : '▼'} ${Math.abs(growthPct).toFixed(1)}%</div>
        <div class="a-sub">vs. ${formatCurrency(lastMonthEarnings, disp)} last month</div>
      </div>
      <div class="a-card" style="grid-column:1/-1;">
        <div class="a-label">Total earnings by original currency</div>
        <div class="curr-breakdown">
          ${CURRENCIES.map(c => `<div class="cb-row"><span>${CURRENCY_META[c].label}</span><span class="cb-c">${formatCurrency(byCurrency[c] || 0, c)}</span></div>`).join('')}
        </div>
      </div>
      ${networkEntries.length ? `
      <div class="a-card" style="grid-column:1/-1;">
        <div class="a-label">Earnings by network (in ${disp})</div>
        <div class="curr-breakdown">
          ${networkEntries.map(([n, v]) => `<div class="cb-row"><span>${escapeHTML(n)}</span><span class="cb-c">${formatCurrency(v, disp)}</span></div>`).join('')}
        </div>
      </div>` : ''}
    </div>

    ${logs.length > 0 ? `
      <div class="chart-panel">
        <h3>Recent commission</h3>
        <p class="hint" style="color:var(--muted);font-size:12px;margin:2px 0 0;">Last ${recentLogs.length} logged entries, converted to ${disp}</p>
        <div class="chart-bars">
          ${recentLogs.map(l => `<div class="bar-wrap"><div class="bar" style="height:${Math.max(6,(logConverted(l)/maxCommission)*100)}%" title="${formatCurrency(logConverted(l), disp)} on ${l.date}"></div><div class="bar-label">${l.date.slice(5)}</div></div>`).join('')}
        </div>
        ${topProduct ? `<div class="top-performer"><span>🏆 Top link: <strong>${escapeHTML(topProduct.name)}</strong></span><span class="figs">${formatCurrency(productEarningsConverted(topProduct.id), disp)}</span></div>` : ''}
      </div>
    ` : ''}

    <div class="section-head">
      <h2>Your links</h2>
      <div class="section-actions">
        <button class="btn-ghost" id="mode-single">${addMode === 'single' ? 'Close' : '+ New link'}</button>
        <button class="btn-ghost" id="mode-bulk">${addMode === 'bulk' ? 'Close' : '+ Bulk add'}</button>
      </div>
    </div>

    ${addMode === 'single' ? renderAddForm() : ''}
    ${addMode === 'bulk' ? renderBulkForm() : ''}

    ${products.length > 0 ? `
      <div class="search-row">
        <input id="search-input" type="text" placeholder="Search your links…" value="${escapeHTML(searchTerm)}" />
        <select id="filter-cat">
          <option value="All" ${filterCategory==='All'?'selected':''}>All categories</option>
          ${Object.keys(CATEGORIES).map(c => `<option value="${c}" ${filterCategory===c?'selected':''}>${c}</option>`).join('')}
        </select>
        <select id="sort-mode">
          <option value="newest" ${sortMode==='newest'?'selected':''}>Newest</option>
          <option value="earnings" ${sortMode==='earnings'?'selected':''}>Top earning</option>
        </select>
      </div>
    ` : ''}

    ${products.length === 0 && !addMode ? `<div class="empty">No links yet. Paste an Amazon (or other) product URL to create your first affiliate link and caption.</div>` :
      visibleProducts.length === 0 && products.length > 0 ? `<div class="empty">No links match that search or filter.</div>` :
      visibleProducts.map(cardHTML).join('')}

    <div class="section-head"><h2>Log today's numbers</h2></div>
    <div class="panel">
      <p class="hint">Copy these from your affiliate dashboard — this app can't pull them automatically. Enter the amount exactly as paid out by the network, in its original currency.</p>
      <div class="row-2">
        <div class="field" style="grid-column:1/-1;"><label for="log-product">Product / link</label>
          <select id="log-product">${products.length === 0 ? '<option value="">Add a link first</option>' : products.map(p => `<option value="${p.id}">${escapeHTML(p.name)} (${p.platform})</option>`).join('')}</select>
        </div>
        <div class="field"><label for="log-clicks">Clicks</label><input id="log-clicks" type="number" min="0" placeholder="0" /></div>
        <div class="field"><label for="log-orders">Orders</label><input id="log-orders" type="number" min="0" placeholder="0" /></div>
        <div class="field"><label for="log-amount">Commission amount</label><input id="log-amount" type="number" min="0" step="0.01" placeholder="0.00" /></div>
        <div class="field"><label for="log-currency">Currency received</label>
          <select id="log-currency">${CURRENCIES.map(c => `<option value="${c}" ${c===disp?'selected':''}>${CURRENCY_META[c].symbol} ${c}</option>`).join('')}</select>
        </div>
      </div>
      <button class="btn-primary" id="save-log" ${products.length === 0 ? 'disabled' : ''}>Add entry</button>
    </div>

    <div class="section-head"><h2>Earnings history</h2></div>
    ${logs.length ? `
      <div class="panel">
        <div class="table-scroll">
          <table class="history-table">
            <thead><tr><th>Date</th><th>Network</th><th>Original</th><th>Converted (${disp})</th><th>Clicks</th><th>Orders</th></tr></thead>
            <tbody>
              ${logs.slice().reverse().slice(0, 25).map(l => `
                <tr>
                  <td>${l.date}</td>
                  <td>${escapeHTML(l.network || l.productName)}</td>
                  <td class="orig-amt">${formatCurrency(l.originalAmount, l.currency)}</td>
                  <td class="conv-amt">${formatCurrency(logConverted(l), disp)}</td>
                  <td>${l.clicks}</td>
                  <td>${l.orders}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    ` : `<div class="empty">No earnings logged yet.</div>`}

    <p class="footnote">Your data is private to your account and synced securely. Amounts are stored in their original currency; conversions shown are estimates based on the latest available exchange rate. Every post needs a visible #ad disclosure.<br>
      <a href="./privacy-policy.html" class="legal-link">Privacy Policy</a> · <a href="./terms.html" class="legal-link">Terms &amp; Conditions</a>
    </p>
  `;

  document.getElementById('toggle-settings').addEventListener('click', () => { showSettings = !showSettings; render(); });
  document.getElementById('toggle-theme').addEventListener('click', () => {
    settings.theme = settings.theme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', settings.theme);
    saveSettings(); render();
  });
  document.getElementById('export-csv').addEventListener('click', exportCSV);
  document.getElementById('mode-single').addEventListener('click', () => { addMode = addMode === 'single' ? null : 'single'; render(); });
  document.getElementById('mode-bulk').addEventListener('click', () => { addMode = addMode === 'bulk' ? null : 'bulk'; render(); });
  document.getElementById('refresh-rates').addEventListener('click', async () => { ratesLoading = true; render(); await loadRates(true); render(); toast(rateState.error ? 'Could not refresh rates' : 'Rates refreshed'); });

  document.querySelectorAll('.curr-pill').forEach(btn => btn.addEventListener('click', () => {
    settings.displayCurrency = btn.dataset.curr; saveSettings(); render();
  }));

  if (showSettings) attachSettingsHandlers();
  if (addMode === 'single') attachAddFormHandlers();
  if (addMode === 'bulk') attachBulkFormHandlers();

  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.addEventListener('input', (e) => { searchTerm = e.target.value; render(); document.getElementById('search-input')?.focus(); });
  const filterSel = document.getElementById('filter-cat');
  if (filterSel) filterSel.addEventListener('change', (e) => { filterCategory = e.target.value; render(); });
  const sortSel = document.getElementById('sort-mode');
  if (sortSel) sortSel.addEventListener('change', (e) => { sortMode = e.target.value; render(); });

  document.querySelectorAll('.copy-link').forEach(btn => btn.addEventListener('click', () => copyText(btn.dataset.link, 'Link')));
  document.querySelectorAll('.copy-caption').forEach(btn => btn.addEventListener('click', () => copyText(btn.dataset.caption, 'Caption')));
  document.querySelectorAll('.del-product').forEach(btn => btn.addEventListener('click', () => {
    if (!confirm('Remove this link? Logged earnings for it will stay in history.')) return;
    products = products.filter(p => p.id !== btn.dataset.id);
    saveProducts(); render();
  }));
  document.querySelectorAll('.toggle-qr').forEach(btn => btn.addEventListener('click', () => {
    const id = btn.dataset.id;
    if (expandedQR.has(id)) expandedQR.delete(id); else expandedQR.add(id);
    render();
  }));
  document.querySelectorAll('.download-qr').forEach(btn => btn.addEventListener('click', () => {
    const container = document.getElementById('qr-' + btn.dataset.id);
    const canvas = container?.querySelector('canvas');
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'affiliate-qr.png';
    a.click();
  }));

  const saveLogBtn = document.getElementById('save-log');
  if (saveLogBtn) {
    saveLogBtn.addEventListener('click', () => {
      const pid = document.getElementById('log-product').value;
      const prod = products.find(p => p.id === pid);
      if (!prod) return;
      const clicks = parseInt(document.getElementById('log-clicks').value) || 0;
      const orders = parseInt(document.getElementById('log-orders').value) || 0;
      const originalAmount = parseFloat(document.getElementById('log-amount').value) || 0;
      const currency = document.getElementById('log-currency').value;
      logs.push({
        id: 'log_' + Date.now(),
        productId: prod.id,
        productName: prod.name,
        network: prod.platform,
        clicks, orders,
        originalAmount, currency,
        date: new Date().toISOString().slice(0,10),
      });
      saveLogs(); render();
      toast('Entry added');
    });
  }

  generateQRCodes();
}

function generateQRCodes() {
  expandedQR.forEach(id => {
    const container = document.getElementById('qr-' + id);
    const product = products.find(p => p.id === id);
    if (!container || !product) return;
    container.innerHTML = '';
    try { new QRCode(container, { text: product.link, width: 96, height: 96, colorDark: '#14171C', colorLight: '#F2EFE9' }); } catch (e) {}
  });
}

function renderSettings() {
  const u = currentUser();
  return `
    <div class="panel">
      <div class="settings-tabs">
        <button class="btn-ghost settings-tab ${settingsTab==='profile'?'active':''}" data-tab="profile">Profile</button>
        <button class="btn-ghost settings-tab ${settingsTab==='tags'?'active':''}" data-tab="tags">Tracking IDs</button>
        <button class="btn-ghost settings-tab ${settingsTab==='currency'?'active':''}" data-tab="currency">Currency</button>
        <button class="btn-ghost settings-tab ${settingsTab==='theme'?'active':''}" data-tab="theme">Theme</button>
        <button class="btn-ghost settings-tab ${settingsTab==='data'?'active':''}" data-tab="data">Export data</button>
      </div>

      ${settingsTab === 'profile' ? `
        <h3>Profile</h3>
        <p class="hint">Signed in as ${escapeHTML(u?.email || 'guest')}</p>
        <div class="field"><label for="profile-name">Display name</label><input id="profile-name" type="text" value="${escapeHTML(settings.name || u?.displayName || '')}" placeholder="Your name" /></div>
        <button class="btn-primary" id="save-profile">Save</button>
        <button class="btn-ghost" id="sign-out" style="margin-left:8px;">Sign out</button>
      ` : ''}

      ${settingsTab === 'tags' ? `
        <h3>Affiliate tracking IDs</h3>
        <p class="hint">Add the tag/ID for each program you're part of. Links you create use these automatically.</p>
        ${Object.keys(PLATFORMS).map(pl => `
          <div class="field"><label for="tag-${pl}">${pl} ${pl === 'Amazon' ? '(e.g. yourname-21)' : ''}</label>
          <input id="tag-${pl}" type="text" placeholder="Not set" value="${escapeHTML(settings.tags[pl] || '')}" /></div>
        `).join('')}
        <button class="btn-primary" id="save-tags">Save</button>
      ` : ''}

      ${settingsTab === 'currency' ? `
        <h3>Default display currency</h3>
        <p class="hint">Used across the dashboard and history table. You can also switch it from the dashboard.</p>
        <div class="curr-pills">
          ${CURRENCIES.map(c => `<button class="btn-ghost curr-pill-setting ${c === settings.displayCurrency ? 'active' : ''}" data-curr="${c}">${CURRENCY_META[c].symbol} ${c}</button>`).join('')}
        </div>
      ` : ''}

      ${settingsTab === 'theme' ? `
        <h3>Appearance</h3>
        <p class="hint">Light or dark interface.</p>
        <div style="display:flex;gap:8px;">
          <button class="btn-ghost theme-choice ${settings.theme==='dark'?'active':''}" data-theme="dark">🌙 Dark</button>
          <button class="btn-ghost theme-choice ${settings.theme==='light'?'active':''}" data-theme="light">☀️ Light</button>
        </div>
      ` : ''}

      ${settingsTab === 'data' ? `
        <h3>Export your data</h3>
        <p class="hint">Download everything for your own records or to move to another tool.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn-primary" id="export-csv-settings">Export CSV</button>
          <button class="btn-ghost" id="export-json-settings">Export JSON backup</button>
        </div>
      ` : ''}

      <p class="footnote" style="margin-top:18px;"><a href="./privacy-policy.html" class="legal-link">Privacy Policy</a> · <a href="./terms.html" class="legal-link">Terms &amp; Conditions</a></p>
    </div>
  `;
}

function attachSettingsHandlers() {
  document.querySelectorAll('.settings-tab').forEach(btn => btn.addEventListener('click', () => {
    settingsTab = btn.dataset.tab; render();
  }));

  const saveTagsBtn = document.getElementById('save-tags');
  if (saveTagsBtn) saveTagsBtn.addEventListener('click', () => {
    Object.keys(PLATFORMS).forEach(pl => { settings.tags[pl] = document.getElementById('tag-' + pl).value.trim(); });
    saveSettings();
    products.forEach(p => { p.link = buildAffiliateLink(p.rawUrl, p.platform); p.caption = buildCaption(p.name, p.link); });
    saveProducts();
    render();
    toast('Tracking IDs saved');
  });

  const saveProfileBtn = document.getElementById('save-profile');
  if (saveProfileBtn) saveProfileBtn.addEventListener('click', () => {
    settings.name = document.getElementById('profile-name').value.trim();
    saveSettings(); render();
    toast('Profile saved');
  });

  const signOutBtn = document.getElementById('sign-out');
  if (signOutBtn) signOutBtn.addEventListener('click', async () => {
    await signOutUser();
  });

  document.querySelectorAll('.curr-pill-setting').forEach(btn => btn.addEventListener('click', () => {
    settings.displayCurrency = btn.dataset.curr; saveSettings(); render();
  }));

  document.querySelectorAll('.theme-choice').forEach(btn => btn.addEventListener('click', () => {
    settings.theme = btn.dataset.theme;
    document.documentElement.setAttribute('data-theme', settings.theme);
    saveSettings(); render();
  }));

  const exportCsvBtn = document.getElementById('export-csv-settings');
  if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportCSV);
  const exportJsonBtn = document.getElementById('export-json-settings');
  if (exportJsonBtn) exportJsonBtn.addEventListener('click', exportJSON);
}

function renderAddForm() {
  return `
    <div class="panel">
      <h3>Paste a product link</h3>
      <div class="field"><label for="new-url">Product URL</label><input id="new-url" type="text" placeholder="https://www.amazon.com/dp/..." /></div>
      <div class="row-3">
        <div class="field"><label for="new-name">Product name</label><input id="new-name" type="text" placeholder="e.g. Wireless Earbuds" /></div>
        <div class="field"><label for="new-cat">Category</label><select id="new-cat">${Object.keys(CATEGORIES).map(c => `<option value="${c}">${c}</option>`).join('')}</select></div>
        <div class="field"><label for="new-platform">Platform</label><select id="new-platform">${Object.keys(PLATFORMS).map(p => `<option value="${p}">${p}</option>`).join('')}</select></div>
      </div>
      <button class="btn-primary" id="create-link">Create affiliate link</button>
    </div>
  `;
}

function attachAddFormHandlers() {
  document.getElementById('create-link').addEventListener('click', () => {
    const rawUrl = document.getElementById('new-url').value.trim();
    const name = document.getElementById('new-name').value.trim();
    const category = document.getElementById('new-cat').value;
    const platform = document.getElementById('new-platform').value;
    if (!rawUrl || !name) { alert('Add a product URL and a name.'); return; }
    const link = buildAffiliateLink(rawUrl, platform);
    const caption = buildCaption(name, link);
    products.push({ id: 'prod_' + Date.now(), rawUrl, name, category, platform, link, caption, createdAt: Date.now() });
    saveProducts();
    addMode = null;
    render();
    toast('Link created');
  });
}

function renderBulkForm() {
  return `
    <div class="panel">
      <h3>Bulk add links</h3>
      <p class="hint">One per line, format: <em>url, product name</em>. Same category and platform applied to all.</p>
      <div class="field"><label for="bulk-text">Links</label>
        <textarea id="bulk-text" placeholder="https://www.amazon.com/dp/XXXXXXXXXX, Wireless Earbuds
https://www.amazon.com/dp/YYYYYYYYYY, Yoga Mat"></textarea>
      </div>
      <div class="row-2">
        <div class="field"><label for="bulk-cat">Category</label><select id="bulk-cat">${Object.keys(CATEGORIES).map(c => `<option value="${c}">${c}</option>`).join('')}</select></div>
        <div class="field"><label for="bulk-platform">Platform</label><select id="bulk-platform">${Object.keys(PLATFORMS).map(p => `<option value="${p}">${p}</option>`).join('')}</select></div>
      </div>
      <button class="btn-primary" id="create-bulk">Create links</button>
    </div>
  `;
}

function attachBulkFormHandlers() {
  document.getElementById('create-bulk').addEventListener('click', () => {
    const text = document.getElementById('bulk-text').value.trim();
    const category = document.getElementById('bulk-cat').value;
    const platform = document.getElementById('bulk-platform').value;
    if (!text) { alert('Paste at least one line.'); return; }
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    let count = 0;
    lines.forEach(line => {
      const [rawUrl, ...nameParts] = line.split(',');
      const name = nameParts.join(',').trim() || 'Untitled product';
      if (!rawUrl || !rawUrl.trim()) return;
      const link = buildAffiliateLink(rawUrl.trim(), platform);
      const caption = buildCaption(name, link);
      products.push({ id: 'prod_' + Date.now() + '_' + count, rawUrl: rawUrl.trim(), name, category, platform, link, caption, createdAt: Date.now() });
      count++;
    });
    saveProducts();
    addMode = null;
    render();
    toast(`${count} links created`);
  });
}

function cardHTML(p) {
  const color = CATEGORIES[p.category] || CATEGORIES.Other;
  const earned = productEarningsConverted(p.id);
  return `
    <div class="card">
      <div class="card-top">
        <span class="cat-chip" style="background:${color}26;color:${color};border:1px solid ${color}55">${p.category}</span>
        <span class="plat-chip">${p.platform}</span>
        <span class="name">${escapeHTML(p.name)}</span>
        <button class="del-btn del-product" data-id="${p.id}" aria-label="Remove ${escapeHTML(p.name)}">✕</button>
      </div>
      <div class="card-body">
        ${!settings.tags[p.platform] ? `<div class="warn-inline">No ${p.platform} tag set — add one in ⚙ Settings so this link actually earns you commission.</div>` : ''}
        <div class="link-row"><span class="link-text">${escapeHTML(p.link)}</span><button class="btn-ghost copy-link" data-link="${escapeHTML(p.link)}">Copy link</button></div>
        <div class="caption-box">${escapeHTML(p.caption)}</div>
        <div class="card-actions">
          <button class="btn-ghost copy-caption" data-caption="${escapeHTML(p.caption)}">Copy caption</button>
          <button class="btn-ghost toggle-qr" data-id="${p.id}">${expandedQR.has(p.id) ? 'Hide QR' : 'Show QR'}</button>
        </div>
        ${expandedQR.has(p.id) ? `
          <div class="qr-box">
            <div class="qr-render" id="qr-${p.id}"></div>
            <div><button class="btn-ghost download-qr" data-id="${p.id}" style="margin-top:10px;">Download QR</button></div>
            ${earned > 0 ? `<div class="qr-perf">Earned so far: ${formatCurrency(earned, settings.displayCurrency)}</div>` : ''}
          </div>
        ` : ''}
      </div>
    </div>
  `;
}
