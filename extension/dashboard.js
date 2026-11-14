(async function () {
  const OL = globalThis.OL;
  const { config } = OL;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ROW_LIMIT = 25;
  const LOCK_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  const CHECK = (color) => `<svg role="img" aria-label="Included" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l4 4 10-10"/></svg>`;

  const RECEIPT_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6"/><path d="M9 12h6"/><path d="M9 16h3"/></svg>';
  const REPEAT_LIMIT = 8;

  // `year` is the selected period's start year; with periodMode 'tax', 2025 means the 2025/26 tax year.
  const state = {
    orders: [], paid: false, lastSync: null, year: null, q: '', format: 'xero', showAll: false,
    tags: {}, rules: {}, origin: null, tagFilter: 'all', businessOnly: false, repeatsAll: false, matches: [],
    periodMode: 'calendar', receiptJob: null, rulePrompt: null
  };
  const now = new Date();

  document.querySelectorAll('.price').forEach((el) => (el.textContent = config.PRICE_LABEL));
  document.querySelectorAll('.free-months').forEach((el) => (el.textContent = String(config.FREE_MONTHS)));
  // ?clean hides the sample-data banner and the placeholder ad in preview mode, for store screenshots.
  const cleanPreview = OL.previewMode && new URLSearchParams(location.search).has('clean');
  $('preview-banner').hidden = !OL.previewMode || cleanPreview;

  // ---------- format picker ----------
  $('format').innerHTML = Object.entries(OL.EXPORTS).map(([id, f]) => `<option value="${id}">${esc(f.label)}</option>`).join('');
  $('format').value = state.format;
  $('format').addEventListener('change', (e) => { state.format = e.target.value; renderExport(); });

  // ---------- helpers ----------
  const currency = () => (state.orders.find((o) => o.currency) || {}).currency || 'GBP';
  const fmt = (v) => OL.money(v, currency());
  const mode = () => state.periodMode;
  const periodName = (y = state.year) => OL.periodLabel(y, mode());
  const allYears = () => [...new Set(state.orders.map((o) => OL.periodOf(o.date, mode())))].sort((a, b) => b - a);
  const visible = () => OL.visibleOrders(state.orders, state.paid, now, config.FREE_MONTHS);
  const yearOrders = (list, y) => list.filter((o) => OL.inPeriod(o, y, mode()));
  const monthIndex = (o) => OL.periodMonthIndex(o.date, state.year, mode());
  const isTag = (o, which) => OL.tagOf(o, state.tags, state.rules) === which;
  const niceDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  function ago(ts) {
    if (!ts) return 'not synced yet';
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 1) return 'synced just now';
    if (mins < 60) return `synced ${mins} minute${mins === 1 ? '' : 's'} ago`;
    const hours = Math.round(mins / 60);
    if (hours < 48) return `synced ${hours} hour${hours === 1 ? '' : 's'} ago`;
    return `synced ${Math.round(hours / 24)} days ago`;
  }

  // ---------- render ----------
  function render() {
    const has = state.orders.length > 0;
    $('empty').hidden = has;
    $('content').hidden = !has;
    $('plan-chip').textContent = state.paid ? 'Lifetime' : 'Free plan';
    if (!has) return;

    const vis = visible();
    const hidden = state.orders.length - vis.length;
    const years = allYears();
    if (!years.includes(state.year)) state.year = years[0];
    const label = mode() === 'tax' ? `the ${periodName()} tax year` : periodName();
    document.querySelectorAll('.year-name').forEach((el) => (el.textContent = label));
    document.querySelectorAll('.period-name').forEach((el) => (el.textContent = label));
    document.querySelectorAll('[data-period-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.periodMode === mode())));

    $('sync-line').textContent = state.paid
      ? `${state.orders.length} orders · ${ago(state.lastSync)}`
      : `${vis.length} of ${state.orders.length} orders unlocked · ${ago(state.lastSync)}`;

    $('free-banner').hidden = state.paid || hidden <= 0;
    $('hidden-text').textContent = `${hidden} older order${hidden === 1 ? ' is' : 's are'} hidden on the free plan.`;

    const visYears = new Set(vis.map((o) => OL.periodOf(o.date, mode())));
    $('years').innerHTML = years.map((y) => {
      const locked = !state.paid && !visYears.has(y);
      return `<button type="button" data-year="${y}" aria-pressed="${y === state.year}">${esc(periodName(y))}${locked ? LOCK_SVG : ''}</button>`;
    }).join('');

    renderRules();
    const lockedYear = !state.paid && !visYears.has(state.year);
    $('locked-year').hidden = !lockedYear;
    $('data').hidden = lockedYear;
    if (lockedYear) return;

    const inYear = yearOrders(vis, state.year);
    const s = OL.summarize(inYear, monthIndex);
    const names = OL.periodMonths(mode());
    const months = inYear.map(monthIndex);
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const current = OL.periodOf(today, mode()) === state.year;
    const scopeLabel = !state.paid
      ? (months.length ? `${names[Math.min(...months)]} to ${names[Math.max(...months)]}` : `last ${config.FREE_MONTHS} months`)
      : current ? `${names[0]} to ${names[OL.periodMonthIndex(today, state.year, mode())]}` : mode() === 'tax' ? 'full tax year' : 'full year';
    $('scope-label').textContent = scopeLabel;
    $('kpi-total').textContent = fmt(s.total);
    const biz = OL.summarize(inYear.filter((o) => isTag(o, 'business')));
    $('kpi-biz').textContent = biz.count ? `${fmt(biz.total)} tagged Business (${biz.count} order${biz.count === 1 ? '' : 's'})` : 'Nothing tagged Business yet';
    $('kpi-count').textContent = String(s.count);
    $('kpi-avg').textContent = fmt(s.average);
    $('kpi-refunds').textContent = String(s.refundCount);
    $('kpi-refund-amt').textContent = s.refundCount ? fmt(s.refundTotal) : '';

    renderChart(s, inYear);
    renderCategories(s);
    renderHighlights(s);
    renderRows(vis, inYear);
    renderRepeats(vis);
    renderExport();
    renderReceipts();
  }

  // ---------- receipt pack ----------
  // The dashboard can't read Amazon pages itself, so it stores a job and opens an Amazon orders tab in the
  // background. content.js there loads each invoice in a hidden frame and saves a cleaned copy as
  // receipt:<orderId>. receipts.html then lays them out for printing.
  const RECEIPT_STALE_MS = 2 * 60 * 1000;
  const AMAZON_ORIGIN = /^https:\/\/www\.amazon\.(co\.uk|com)$/;
  let receiptTabId = null;
  const receiptCandidates = () => OL.receiptOrders(visible(), state.tags, state.rules, state.year, mode());
  const jobRunning = (job) => !!job && (job.status === 'pending' || job.status === 'running') && Date.now() - (job.updatedAt || job.createdAt) < RECEIPT_STALE_MS;

  function renderReceipts() {
    $('receipts-paid').hidden = !state.paid;
    $('receipts-locked').hidden = state.paid;
    const list = receiptCandidates();
    const job = state.receiptJob;
    const running = jobRunning(job);
    $('receipts-btn').textContent = list.length ? `Get receipts for ${periodName()} (${list.length})` : `No Business orders in ${periodName()}`;
    $('receipts-btn').disabled = !list.length || running;
    $('receipts-cancel').hidden = !running;
    let status = '';
    if (job) {
      if (running) status = job.status === 'pending' ? 'Opening Amazon in a background tab…' : `Fetching invoice ${Math.min(job.done + 1, job.total)} of ${job.total}…`;
      else if (job.status === 'done') status = `Ready: ${job.total - job.failed} of ${job.total} invoices for ${job.label}.${job.failed ? ` ${job.failed} couldn't be loaded; the pack links to them on Amazon.` : ''}`;
      else if (job.status === 'error') status = job.error || 'Something went wrong while fetching invoices.';
      else if (job.status === 'cancelled') status = job.done ? `Stopped after ${job.done} of ${job.total}.` : 'Stopped.';
      else status = 'The Amazon tab stopped responding. Try again, and keep Amazon signed in.';
    }
    $('receipts-status').textContent = status;
    $('receipts-status').className = `small${job && job.status === 'error' ? ' key-msg-error' : ''}`;
    $('receipts-actions').hidden = !(job && !running && job.done > 0 && (job.status === 'done' || job.status === 'cancelled'));
  }

  async function startReceipts() {
    const list = receiptCandidates();
    if (!list.length || jobRunning(state.receiptJob)) return;
    const job = {
      id: String(Date.now()), status: 'pending', total: list.length, done: 0, failed: 0, createdAt: Date.now(), updatedAt: Date.now(),
      label: mode() === 'tax' ? `the ${periodName()} tax year` : periodName(), period: periodName(),
      orders: list.map((o) => ({ id: o.id, date: o.date, total: o.total, currency: o.currency, items: o.items || [], status: o.status, invoiceUrl: o.invoiceUrl || null }))
    };
    if (OL.previewMode) return previewReceipts(job);
    // Drop the previous pack's invoices before starting a new one.
    const stored = await chrome.storage.local.get(null);
    const old = Object.keys(stored).filter((k) => k.startsWith('receipt:'));
    if (old.length) await chrome.storage.local.remove(old);
    await OL.store.set({ receiptJob: job, cancelReceipts: false });
    state.receiptJob = job;
    renderReceipts();
    const origin = AMAZON_ORIGIN.test(state.origin || '') ? state.origin : config.DEFAULT_ORIGIN;
    const tab = await chrome.tabs.create({ url: `${origin}/your-orders/orders?ref=ol_receipts`, active: false });
    receiptTabId = tab.id;
    await OL.store.set({ receiptTabId: tab.id });
  }

  // Close the background Amazon tab this dashboard opened (remembered in storage across reloads).
  function closeReceiptTab() {
    if (receiptTabId != null && typeof chrome !== 'undefined' && chrome.tabs) chrome.tabs.remove(receiptTabId).catch(() => {});
    if (receiptTabId != null) OL.store.set({ receiptTabId: null });
    receiptTabId = null;
  }

  // A made-up invoice shaped like Amazon's print view (labels and amounts in separate blocks).
  function sampleInvoice(o) {
    const total = o.total || 0;
    const net = Math.round((total / 1.2) * 100) / 100;
    const li = (a, b) => `<li><span>${esc(a)}</span><span>${esc(b)}</span></li>`;
    return `<div><h1>Order Summary</h1><div><span>Order placed</span><span>${esc(new Date(o.date + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))}</span></div>`
      + `<div><span>Order No.</span><span>${esc(o.id)}</span></div><h3>Dispatch to</h3><ul><li>Sam Example</li><li>1 Example Street<br>London AB1 2CD</li><li>United Kingdom</li></ul>`
      + `<h3>Payment method</h3><p>Visa Debit Card •••• 0000</p><h3>Order Summary</h3><ul>${li('Item(s) Subtotal:', fmt(net))}${li('Postage & Packing:', '£0.00')}`
      + `${li('Total before VAT:', fmt(net))}${li('Estimated VAT:', fmt(total - net))}${li('Total:', fmt(total))}${li('Grand Total:', fmt(total))}</ul>`
      + `<h3>Delivered ${esc(new Date(o.date + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }))}</h3>`
      + `<div><div>${esc(o.items[0] || 'Item')}</div><div>Sold by: Amazon.co.uk</div><div>${esc(fmt(total))}</div></div></div>`;
  }

  // Preview mode (page opened outside the extension): a sample pack built from sample orders.
  function previewReceipts(job) {
    const receipts = {};
    job.orders.forEach((o, i) => {
      receipts[o.id] = i === 2
        ? { ok: false, error: 'Amazon took too long to load this invoice.' }
        : { ok: true, html: sampleInvoice(o) };
    });
    Object.assign(job, { status: 'done', done: job.total, failed: job.orders.length > 2 ? 1 : 0, updatedAt: Date.now() });
    try { localStorage.setItem('ol-preview-receipts', JSON.stringify({ job, receipts })); } catch (_) { /* preview only */ }
    state.receiptJob = job;
    renderReceipts();
  }

  function openReceiptPack() {
    if (OL.previewMode) window.open('receipts.html?preview=1', '_blank', 'noopener');
    else chrome.tabs.create({ url: chrome.runtime.getURL('receipts.html') });
  }

  function renderChart(s) {
    const fullYear = OL.summarize(yearOrders(state.orders, state.year), monthIndex).byMonth;
    const short = OL.periodMonths(mode());
    const full = OL.periodMonthsFull(mode());
    const max = Math.max(1, ...fullYear);
    let peak = -1;
    s.byMonth.forEach((v, i) => { if (v > 0 && (peak < 0 || v > s.byMonth[peak])) peak = i; });
    let anyLocked = false;
    $('chart').innerHTML = fullYear.map((whole, i) => {
      const shown = s.byMonth[i];
      const locked = whole > 0 && shown === 0;
      anyLocked = anyLocked || locked;
      const value = locked ? whole : shown;
      const h = value > 0 ? Math.max(6, Math.round((value / max) * 180)) : 4;
      const bg = value === 0 ? 'var(--line)' : locked ? 'var(--locked)' : i === peak ? 'var(--peak)' : 'var(--accent)';
      const label = shown > 0 ? `£${Math.round(shown)}` : '';
      const aria = locked ? `${full[i]}: locked` : `${full[i]}: ${fmt(shown)}`;
      return `<div class="bar-col"><div class="bar-val">${esc(label)}</div><div class="bar" role="img" aria-label="${esc(aria)}" style="height:${h}px;background:${bg}"></div><div>${short[i]}</div></div>`;
    }).join('');
    $('legend-locked').hidden = !anyLocked;
  }

  function renderCategories(s) {
    const top = s.byCategory.length ? s.byCategory[0][1] : 1;
    $('cats').innerHTML = s.byCategory.map(([name, amt]) => `
      <div class="cat-row">
        <div class="cat-top"><span>${esc(name)}</span><b>${esc(fmt(amt))}</b></div>
        <div class="cat-track"><div class="cat-fill" style="width:${Math.round((amt / top) * 100)}%"></div></div>
      </div>`).join('') || '<div class="muted">No spending in this period.</div>';
  }

  function renderHighlights(s) {
    let peak = -1;
    s.byMonth.forEach((v, i) => { if (v > 0 && (peak < 0 || v > s.byMonth[peak])) peak = i; });
    const active = s.byMonth.filter((v) => v > 0).length;
    $('hl-peak').textContent = peak >= 0 ? `${OL.periodMonthsFull(mode())[peak]} · ${fmt(s.byMonth[peak])}` : '—';
    $('hl-cat').textContent = s.byCategory.length ? `${s.byCategory[0][0]} · ${fmt(s.byCategory[0][1])}` : '—';
    $('hl-month').textContent = active ? fmt(s.total / active) : '—';
  }

  function renderRows(vis, inYear) {
    const q = state.q.trim().toLowerCase();
    // Searching looks through every unlocked order; otherwise show the selected year.
    const source = q ? vis : inYear;
    const searched = q ? source.filter((o) => `${(o.items || []).join(' ')} ${o.category} ${o.id}`.toLowerCase().includes(q)) : source;
    const matches = OL.filterByTag(searched, state.tags, state.tagFilter, state.rules);
    state.matches = matches;
    const rows = state.showAll ? matches : matches.slice(0, ROW_LIMIT);
    const tagWord = state.tagFilter === 'all' ? '' : state.tagFilter === 'business' ? 'Business ' : 'Personal ';
    $('orders-title').textContent = q ? 'Search results' : tagWord ? `${tagWord}orders in ${periodName()}` : `Orders in ${periodName()}`;
    $('orders-count').textContent = `${rows.length} of ${matches.length} shown`;
    document.querySelectorAll('[data-tag-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tagFilter === state.tagFilter)));

    $('rows').innerHTML = rows.map((o) => {
      const chip = o.status === 'Refunded' ? 'chip-warn' : o.status === 'Delivered' ? 'chip-ok' : 'chip-muted';
      const items = (o.items && o.items.length) ? o.items.map(esc).join('<br>') : '<span class="muted">Item names not found</span>';
      const info = OL.tagInfo(o, state.tags, state.rules);
      const biz = info.tag === 'business';
      const how = info.auto ? ' (tagged automatically)' : '';
      const tag = `<button type="button" class="tag${biz ? ' tag-biz' : ''}${info.auto ? ' tag-auto' : ''}" data-tag-id="${esc(o.id)}" title="${info.auto ? 'Tagged automatically: it contains a product you always tag Business' : ''}" aria-label="${biz ? 'Business' : 'Personal'} order${how}. Mark as ${biz ? 'Personal' : 'Business'}">${biz ? 'Business' : 'Personal'}</button>`;
      const invoice = `<a class="icon-btn" href="${esc(OL.invoiceUrl(o, state.origin))}" target="_blank" rel="noopener noreferrer" title="Open invoice on Amazon" aria-label="Invoice for order ${esc(o.id)}">${RECEIPT_SVG}</a>`;
      return `<tr><td class="date">${esc(niceDate(o.date))}</td><td class="items">${items}</td><td class="cat">${esc(o.category)}</td><td class="num">${o.total != null ? esc(fmt(o.total)) : '—'}</td><td><span class="chip ${chip}">${esc(o.status)}</span></td><td>${tag}</td><td class="act">${invoice}</td></tr>`;
    }).join('');

    // Bulk action covers every matching order, not just the rows on screen, and says how many.
    const allBiz = matches.length > 0 && matches.every((o) => isTag(o, 'business'));
    $('bulk-tag').hidden = matches.length === 0;
    $('bulk-tag').dataset.to = allBiz ? 'personal' : 'business';
    $('bulk-tag').textContent = `Mark ${matches.length === 1 ? 'this order' : `all ${matches.length}`} as ${allBiz ? 'Personal' : 'Business'}`;

    $('no-rows').hidden = matches.length > 0;
    $('no-rows').textContent = q ? `No unlocked ${tagWord.toLowerCase()}orders match “${state.q}”.` : state.tagFilter !== 'all' ? `No ${tagWord.toLowerCase()}orders in this period.` : 'No orders in this period.';
    $('show-more').hidden = state.showAll || matches.length <= ROW_LIMIT;
  }

  function renderRepeats(vis) {
    const synced = state.orders.some((o) => Array.isArray(o.products));
    const groups = synced ? OL.repeatPurchases(state.paid ? vis : state.orders) : [];
    const locked = !state.paid && groups.length > 0;
    $('repeats-locked').hidden = !locked;
    $('repeats-teaser').textContent = `You've bought ${groups.length} item${groups.length === 1 ? '' : 's'} more than once.`;
    $('repeats-count').textContent = state.paid && groups.length ? `${groups.length} item${groups.length === 1 ? '' : 's'}` : '';
    $('repeats-empty').hidden = groups.length > 0;
    $('repeats-empty').textContent = synced
      ? 'Nothing bought more than once yet.'
      : 'Sync again to find repeat purchases. Orders synced before this update don’t include product IDs.';
    if (!state.paid) {
      $('repeats-list').innerHTML = '';
      $('repeats-note').hidden = true;
      $('repeats-more').hidden = true;
      return;
    }

    const shown = state.repeatsAll ? groups : groups.slice(0, REPEAT_LIMIT);
    $('repeats-list').innerHTML = shown.map((g) => {
      let change = '';
      if (g.change != null) {
        const pct = Math.round(Math.abs(g.change) * 100);
        const since = `since ${g.firstDate.slice(0, 4)}`;
        const prices = `${fmt(g.firstPrice)} → ${fmt(g.lastPrice)}`;
        change = pct === 0
          ? `<span class="chip chip-muted">Same price ${esc(since)}</span>`
          : `<span class="chip ${g.change > 0 ? 'chip-warn' : 'chip-ok'}">${g.change > 0 ? 'Up' : 'Down'} ${pct}% ${esc(since)}</span>`;
        change += `<div class="muted small">${esc(prices)}</div>`;
      }
      const times = `Bought ${g.count} times${g.units > g.count ? ` (${g.units} units)` : ''} · last ${niceDate(g.lastDate)}`;
      const spent = g.spent == null
        ? '<b>—</b><div class="muted small">Price not shown</div>'
        : `<b>${esc(fmt(g.spent))}</b><div class="muted small">${g.pricedCount < g.count ? `spent on ${g.pricedCount} of ${g.count}` : 'spent'}</div>`;
      return `<li class="repeat">
        <div class="repeat-main"><div class="repeat-title">${esc(g.title)}</div><div class="muted small">${esc(times)}</div></div>
        <div class="repeat-spent num">${spent}</div>
        <div class="repeat-change">${change}</div>
        <a class="btn btn-secondary btn-sm" href="${esc(OL.productUrl(g.asin, state.origin))}" target="_blank" rel="noopener noreferrer">View on Amazon<span class="sr-only">: ${esc(g.title)}</span></a>
      </li>`;
    }).join('');
    $('repeats-note').hidden = !shown.some((g) => g.fromOrderTotals);
    $('repeats-more').hidden = state.repeatsAll || groups.length <= REPEAT_LIMIT;
  }

  // A hand-set tag is stored as 'business' or 'personal'. 'personal' is only stored when needed to
  // override an "always Business" product rule; otherwise untagged already means Personal.
  async function setTags(ids, to) {
    const tags = { ...state.tags };
    const byId = new Map(state.orders.map((o) => [o.id, o]));
    for (const id of ids) {
      delete tags[id];
      const o = byId.get(id);
      const ruleSays = o ? OL.tagOf(o, {}, state.rules) : 'personal';
      if (to !== ruleSays) tags[id] = to;
    }
    state.tags = tags;
    render();
    await OL.store.set({ tags });
  }

  // After an order is tagged Business by hand, offer to always tag its products Business.
  function offerRule(order) {
    const fresh = (order.products || []).filter((p) => p.asin && state.rules[p.asin] !== 'business');
    if (!fresh.length) return;
    const first = fresh[0].title.length > 48 ? `${fresh[0].title.slice(0, 46)}…` : fresh[0].title;
    const what = fresh.length === 1 ? `“${first}”` : `“${first}” and ${fresh.length - 1} other product${fresh.length === 2 ? '' : 's'} in this order`;
    state.rulePrompt = fresh.map((p) => p.asin);
    $('rule-prompt-text').textContent = `Always tag ${what} as Business, in past and future orders?`;
    $('rule-prompt').hidden = false;
  }
  const closeRulePrompt = () => { state.rulePrompt = null; $('rule-prompt').hidden = true; };

  async function setRules(rules) {
    state.rules = rules;
    render();
    await OL.store.set({ tagRules: rules });
  }

  function renderRules() {
    const titles = new Map();
    for (const o of state.orders) for (const p of o.products || []) if (p.asin && !titles.has(p.asin)) titles.set(p.asin, p.title);
    const asins = Object.keys(state.rules).filter((a) => state.rules[a] === 'business');
    $('rules').hidden = asins.length === 0;
    $('rules-list').innerHTML = asins.map((a) => {
      const n = state.orders.filter((o) => (o.products || []).some((p) => p.asin === a)).length;
      return `<li><span class="rule-title">${esc(titles.get(a) || a)}</span><span class="muted small">${n} order${n === 1 ? '' : 's'}</span>
        <button type="button" class="btn btn-ghost btn-sm" data-remove-rule="${esc(a)}" aria-label="Stop tagging ${esc(titles.get(a) || a)} automatically">Remove</button></li>`;
    }).join('');
  }

  const exportSet = (orders) => (state.businessOnly ? OL.filterByTag(orders, state.tags, 'business', state.rules) : orders);

  function renderExport() {
    const f = OL.EXPORTS[state.format];
    $('format-hint').textContent = f.hint;
    $('export-paid').hidden = !state.paid;
    $('export-locked').hidden = state.paid;
    const yearSet = exportSet(yearOrders(visible(), state.year));
    const allSet = exportSet(visible());
    const kind = state.businessOnly ? 'Business orders' : 'orders';
    $('dl-year').textContent = `Download ${periodName()} ${kind}${state.businessOnly ? ` (${yearSet.length})` : ''}`;
    $('dl-all').textContent = `Download all ${kind}${state.businessOnly ? ` (${allSet.length})` : ''}`;
    $('dl-year').disabled = yearSet.length === 0;
    $('dl-all').disabled = allSet.length === 0;
    $('biz-only').checked = state.businessOnly;
    const bizTotal = OL.filterByTag(visible(), state.tags, 'business', state.rules).length;
    $('biz-count').textContent = `(${bizTotal} tagged)`;
    $('biz-none').hidden = !state.businessOnly || bizTotal > 0;

    const p = (OL.partners || {})[state.format] || {};
    const showPartner = !!p.url || (OL.previewMode && !cleanPreview);
    $('partner').hidden = !showPartner;
    if (showPartner) {
      $('partner-title').textContent = p.title || '';
      $('partner-body').textContent = p.body || '';
      $('partner-link').textContent = p.url ? `${p.offer || 'See the offer'} on ${p.name}` : `[OFFER] on ${p.name || '[PARTNER]'} (set the link in config.js)`;
      $('partner-link').href = p.url || '#export';
    }
  }

  function download(orders, label) {
    const f = OL.EXPORTS[state.format];
    const set = exportSet(orders);
    if (!set.length) return;
    const blob = new Blob([f.build(set, { origin: state.origin, tags: state.tags, rules: state.rules })], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `order-ledger-${state.format}${state.businessOnly ? '-business' : ''}-${label}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- upgrade dialog ----------
  const FEATURES = [
    [`Last ${config.FREE_MONTHS} months of orders`, true],
    ['Full order history, every year', false],
    ['Search all orders', false],
    ['Spending by category', true],
    ['Invoice link on every order', true],
    ['Tag orders as Business or Personal', true],
    ['Export to CSV, Xero, FreeAgent and QuickBooks', false],
    ['Export Business orders only', false],
    ['UK tax-year view (6 April to 5 April)', true],
    ['Always tag a product as Business', true],
    ['Receipt pack: every Business invoice in one PDF', false],
    ['Repeat purchases and price changes', false]
  ];
  $('compare').innerHTML = FEATURES.map(([name, free]) =>
    `<tr><td>${esc(name)}</td><td>${free ? CHECK('#5B616E') : '<span class="muted" aria-label="Not included">–</span>'}</td><td>${CHECK('#1D4ED8')}</td></tr>`).join('');

  function openUpgrade() {
    $('upgrade-sub').textContent = state.orders.length
      ? `You've already synced ${state.orders.length} orders. See every one of them and export them whenever you like.`
      : 'See every order you have placed and export them whenever you like.';
    if (!$('upgrade').open) $('upgrade').showModal();
  }

  // ---------- events ----------
  document.addEventListener('click', (e) => {
    const yearBtn = e.target.closest('[data-year]');
    if (yearBtn) { state.year = +yearBtn.dataset.year; state.showAll = false; render(); return; }
    const modeBtn = e.target.closest('[data-period-mode]');
    if (modeBtn) {
      if (modeBtn.dataset.periodMode !== state.periodMode) {
        state.periodMode = modeBtn.dataset.periodMode === 'tax' ? 'tax' : 'calendar';
        state.year = null;
        state.showAll = false;
        render();
        OL.store.set({ periodMode: state.periodMode });
      }
      return;
    }
    const tagBtn = e.target.closest('[data-tag-id]');
    if (tagBtn) {
      const id = tagBtn.dataset.tagId;
      const order = state.orders.find((o) => o.id === id);
      if (!order) return;
      const to = isTag(order, 'business') ? 'personal' : 'business';
      setTags([id], to).then(() => {
        // Re-rendering replaces the row, so put focus back on the same order's button.
        const again = [...document.querySelectorAll('[data-tag-id]')].find((b) => b.dataset.tagId === id);
        if (again) again.focus();
        if (to === 'business') offerRule(order);
        else closeRulePrompt();
      });
      return;
    }
    const removeRule = e.target.closest('[data-remove-rule]');
    if (removeRule) {
      const rules = { ...state.rules };
      delete rules[removeRule.dataset.removeRule];
      setRules(rules);
      return;
    }
    const filterBtn = e.target.closest('[data-tag-filter]');
    if (filterBtn) { state.tagFilter = filterBtn.dataset.tagFilter; state.showAll = false; render(); return; }
    if (e.target.closest('.js-upgrade')) openUpgrade();
  });
  $('bulk-tag').addEventListener('click', () => setTags(state.matches.map((o) => o.id), $('bulk-tag').dataset.to));
  $('biz-only').addEventListener('change', (e) => { state.businessOnly = e.target.checked; renderExport(); });
  $('repeats-more').addEventListener('click', () => { state.repeatsAll = true; render(); });
  $('rule-yes').addEventListener('click', () => {
    if (!state.rulePrompt) return closeRulePrompt();
    const rules = { ...state.rules };
    for (const asin of state.rulePrompt) rules[asin] = 'business';
    closeRulePrompt();
    setRules(rules);
  });
  $('rule-no').addEventListener('click', closeRulePrompt);
  $('receipts-btn').addEventListener('click', () => startReceipts());
  $('receipts-cancel').addEventListener('click', () => OL.store.set({ cancelReceipts: true }));
  $('receipts-open').addEventListener('click', openReceiptPack);
  $('search').addEventListener('input', (e) => { state.q = e.target.value; state.showAll = false; render(); });
  $('show-more').addEventListener('click', () => { state.showAll = true; render(); });
  $('dl-year').addEventListener('click', () => download(yearOrders(visible(), state.year), periodName().replace('/', '-')));
  $('dl-all').addEventListener('click', () => download(visible(), 'all'));
  const canPay = OL.payments.canPay();
  $('pay-btn').disabled = !canPay;
  $('pay-missing').hidden = canPay;
  $('pay-btn').addEventListener('click', () => OL.payments.openPayment());
  if (config.SUPPORT_EMAIL) {
    $('lost-key').hidden = false;
    $('lost-key').textContent = `Each key works in one browser. Lost it, or moving to a new computer? Email ${config.SUPPORT_EMAIL} from the address you paid with.`;
  }
  $('activate-btn').addEventListener('click', async () => {
    const msg = $('key-msg');
    msg.className = 'muted';
    msg.textContent = 'Checking…';
    const result = await OL.payments.activate($('licence-key').value);
    if (!result.ok) {
      msg.className = 'key-msg-error';
      msg.textContent = result.reason;
      return;
    }
    msg.className = 'key-msg-ok';
    msg.textContent = 'Unlocked. Thank you!';
    await load();
    setTimeout(() => $('upgrade').close(), 900);
  });

  async function load() {
    const data = await OL.store.get(['orders', 'lastSync', 'tags', 'tagRules', 'origin', 'periodMode', 'receiptJob', 'receiptTabId']);
    if (data.receiptTabId != null) receiptTabId = data.receiptTabId;
    state.orders = data.orders || [];
    state.lastSync = data.lastSync || null;
    state.tags = data.tags || {};
    state.rules = data.tagRules || {};
    state.periodMode = data.periodMode === 'tax' ? 'tax' : 'calendar';
    if (data.receiptJob) state.receiptJob = data.receiptJob;
    state.origin = data.origin || config.DEFAULT_ORIGIN;
    state.paid = await OL.payments.isPaid();
    render();
  }

  // Live updates while a sync is running, and after payment.
  // Tag changes from another dashboard tab come through here too.
  // Our own tag writes are already on screen, so only reload when the stored tags differ from ours.
  OL.store.onChange((changes) => {
    const differs = (key, mine) => changes[key] && JSON.stringify(changes[key].newValue || {}) !== JSON.stringify(mine);
    if (changes.receiptJob) {
      state.receiptJob = changes.receiptJob.newValue || null;
      const job = state.receiptJob;
      if (job && !jobRunning(job) && job.status !== 'pending' && job.status !== 'running') closeReceiptTab();
      renderReceipts();
    }
    if (changes.orders || changes.lastSync || changes.paidAt || changes.licence || differs('tags', state.tags) || differs('tagRules', state.rules)) load();
  });
  // A stalled job (Amazon tab closed) shows as stalled without waiting for another storage change.
  setInterval(() => { if (state.receiptJob && state.receiptJob.status === 'running') renderReceipts(); }, 15000);

  await load();
  if (location.hash === '#upgrade' && !state.paid) openUpgrade();
  // Sections fill in after the data loads, so jump to a linked one (#orders, #repeats…) now.
  else if (/^#[a-z-]+$/.test(location.hash)) {
    const target = document.querySelector(location.hash);
    if (target) target.scrollIntoView();
  }
})();
