(async function () {
  const OL = globalThis.OL;
  const { config } = OL;
  const $ = (id) => document.getElementById(id);
  const views = ['idle', 'syncing', 'error', 'done'];
  const show = (name) => views.forEach((v) => ($(`view-${v}`).hidden = v !== name));
  const STALE_MS = 90 * 1000;
  let paid = false;

  document.querySelectorAll('.price').forEach((el) => (el.textContent = config.PRICE_LABEL));

  async function render() {
    const { orders = [], syncState = {} } = await OL.store.get(['orders', 'syncState']);
    $('plan-chip').textContent = paid ? 'Lifetime' : 'Free plan';

    const live = syncState.status === 'syncing' && Date.now() - (syncState.updatedAt || 0) < STALE_MS;
    if (live) {
      show('syncing');
      const pct = syncState.yearCount ? Math.round(((syncState.yearIndex - 1) / syncState.yearCount) * 100) : 5;
      $('sync-bar').style.width = Math.max(5, pct) + '%';
      $('sync-bar').parentElement.setAttribute('aria-valuenow', String(pct));
      $('sync-where').textContent = syncState.year ? `Reading ${syncState.year} · year ${syncState.yearIndex} of ${syncState.yearCount}` : 'Starting…';
      $('sync-found').textContent = String(syncState.ordersFound || 0);
      return;
    }
    if (syncState.status === 'error' && !orders.length) {
      show('error');
      $('error-msg').textContent = syncState.error || '';
      return;
    }
    if (!orders.length) return show('idle');

    show('done');
    const now = new Date();
    const visible = OL.visibleOrders(orders, paid, now, config.FREE_MONTHS);
    const scope = paid ? visible.filter((o) => o.date.startsWith(String(now.getFullYear()))) : visible;
    const s = OL.summarize(scope);
    const cur = (orders.find((o) => o.currency) || {}).currency || 'GBP';
    $('sum-label').textContent = paid ? `Spent so far in ${now.getFullYear()}` : `Spent in the last ${config.FREE_MONTHS} months`;
    $('sum-total').textContent = OL.money(s.total, cur);
    $('sum-count').textContent = String(s.count);
    $('sum-avg').textContent = OL.money(s.average, cur);
    $('sum-refunds').textContent = String(s.refundCount);
    const hidden = orders.length - visible.length;
    $('hidden-notice').hidden = paid || hidden <= 0;
    $('hidden-count').textContent = String(hidden);
  }

  async function startSync() {
    await OL.store.set({ cancelSync: false });
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try {
      // Works when the active tab is an Amazon orders page (the content script answers).
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'start-sync' });
      if (res && res.ok) return;
    } catch (_) {
      /* no content script on this tab */
    }
    const { origin } = await OL.store.get('origin');
    await OL.store.set({ pendingSync: Date.now() });
    chrome.tabs.create({ url: `${origin || config.DEFAULT_ORIGIN}/your-orders/orders` });
  }

  $('sync-btn').addEventListener('click', startSync);
  $('retry-btn').addEventListener('click', startSync);
  $('resync-btn').addEventListener('click', startSync);
  $('cancel-btn').addEventListener('click', async () => {
    await OL.store.set({ cancelSync: true });
    const { syncState = {} } = await OL.store.get('syncState');
    await OL.store.set({ syncState: { ...syncState, status: 'cancelled', updatedAt: Date.now() } });
  });
  $('open-dashboard').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') }));
  $('upgrade-btn').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html#upgrade') }));

  OL.store.onChange(async (changes) => {
    if (changes.paidAt || changes.licence) paid = await OL.payments.isPaid();
    render();
  });

  paid = await OL.payments.isPaid();
  render();
})();
