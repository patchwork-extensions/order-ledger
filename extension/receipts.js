// Lays out the receipt pack: a summary sheet, then each Business order's cleaned Amazon invoice on its
// own printed page. Invoices were cleaned when fetched (sanitize.js) and are cleaned again here.
(async function () {
  const OL = globalThis.OL;
  const $ = (id) => document.getElementById(id);
  const el = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  const niceDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  $('print').addEventListener('click', () => window.print());

  let job = null;
  let receipts = {};
  let origin = null;
  if (OL.previewMode) {
    try {
      const data = JSON.parse(localStorage.getItem('ol-preview-receipts') || 'null');
      if (data) ({ job, receipts } = data);
    } catch (_) { /* nothing to show */ }
  } else {
    const data = await chrome.storage.local.get(['receiptJob', 'origin']);
    job = data.receiptJob || null;
    origin = data.origin || null;
    if (job) {
      const stored = await chrome.storage.local.get(job.orders.map((o) => `receipt:${o.id}`));
      for (const o of job.orders) receipts[o.id] = stored[`receipt:${o.id}`];
    }
  }

  if (!job || !job.orders || !job.orders.length) {
    $('empty').hidden = false;
    return;
  }

  const currency = (job.orders.find((o) => o.currency) || {}).currency || 'GBP';
  const money = (v) => OL.money(v || 0, currency);
  const orders = job.orders.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const included = orders.filter((o) => receipts[o.id] && receipts[o.id].ok).length;
  const total = orders.reduce((s, o) => s + (typeof o.total === 'number' ? o.total : 0), 0);

  document.title = `Business receipts, ${job.period} · Order Ledger`;
  $('title').textContent = `Business receipts: ${job.label}`;
  $('subtitle').textContent = `Amazon orders tagged Business in Order Ledger · made ${new Date(job.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`;
  $('f-count').textContent = String(orders.length);
  $('f-total').textContent = money(total);
  $('f-included').textContent = `${included} of ${orders.length}`;

  for (const o of orders) {
    const tr = document.createElement('tr');
    const items = (o.items || []).length ? `${o.items[0]}${o.items.length > 1 ? ` (+${o.items.length - 1} more)` : ''}` : 'Amazon order';
    for (const [text, cls] of [[niceDate(o.date)], [o.id], [items], [o.status], [typeof o.total === 'number' ? money(o.total) : '—', 'num']]) {
      tr.appendChild(el('td', text, cls));
    }
    $('rows').appendChild(tr);
  }
  $('summary').hidden = false;

  const signed = (v) => (v < 0 ? `−${money(-v)}` : money(v));

  // One receipt page from what parseInvoiceLines read off Amazon's order summary.
  function receiptSheet(o, data) {
    const sheet = el('section', null, 'sheet invoice receipt');
    const head = el('div', null, 'r-head');
    const left = el('div');
    left.appendChild(el('div', 'Amazon order', 'r-kicker'));
    left.appendChild(el('h2', `Receipt for order ${o.id}`));
    const right = el('div', null, 'r-paid');
    right.appendChild(el('span', 'Total paid'));
    right.appendChild(el('b', signed(data.grandTotal)));
    head.appendChild(left);
    head.appendChild(right);
    sheet.appendChild(head);

    const meta = el('dl', null, 'r-meta');
    const fact = (label, value) => {
      if (!value) return;
      const box = el('div');
      box.appendChild(el('dt', label));
      box.appendChild(el('dd', value));
      meta.appendChild(box);
    };
    fact('Order placed', data.placed ? niceDate(data.placed) : niceDate(o.date));
    fact('Paid with', data.payment.join(', '));
    fact('Dispatched to', data.dispatchTo.join(', '));
    fact('Status', data.status || o.status);
    sheet.appendChild(meta);

    if (data.items.length) {
      const table = el('table', null, 'r-items');
      const hr = document.createElement('tr');
      for (const [t, c] of [['Item'], ['Sold by'], ['Price', 'num']]) { const th = el('th', t, c); th.scope = 'col'; hr.appendChild(th); }
      const thead = el('thead');
      thead.appendChild(hr);
      table.appendChild(thead);
      const tbody = el('tbody');
      for (const it of data.items) {
        const tr = document.createElement('tr');
        tr.appendChild(el('td', it.title));
        tr.appendChild(el('td', it.soldBy || '—', 'muted'));
        tr.appendChild(el('td', it.price == null ? '—' : money(it.price), 'num'));
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      sheet.appendChild(table);
    }

    const totals = el('table', null, 'r-totals');
    const tbody = el('tbody');
    data.summary.forEach((row) => {
      const grand = row.amount === data.grandTotal && /grand total|total for this order|order total/i.test(row.label);
      const tr = el('tr', null, grand ? 'grand' : '');
      tr.appendChild(el('td', row.label));
      tr.appendChild(el('td', signed(row.amount), 'num'));
      tbody.appendChild(tr);
    });
    totals.appendChild(tbody);
    sheet.appendChild(totals);

    const note = el('p', "Copied from Amazon's order summary by Order Ledger. This isn't a VAT invoice: if you need one, download the seller's invoice for this order on Amazon at ", 'r-note');
    note.appendChild(el('span', OL.invoiceUrl(o, origin), 'r-url'));
    sheet.appendChild(note);
    return sheet;
  }

  for (const o of orders) {
    const r = receipts[o.id];
    const data = r && r.ok && r.html ? OL.parseInvoiceLines(OL.invoiceLines(r.html), o) : null;
    if (data) {
      $('invoices').appendChild(receiptSheet(o, data));
      continue;
    }

    // Couldn't read it as a receipt: show the plain copy, or a pointer to Amazon.
    const sheet = el('section', null, 'sheet invoice');
    const head = el('div', null, 'invoice-head');
    head.appendChild(el('h2', `Order ${o.id}`));
    head.appendChild(el('span', `${niceDate(o.date)} · ${typeof o.total === 'number' ? money(o.total) : 'no total shown'}`, 'muted'));
    sheet.appendChild(head);

    if (r && r.ok && r.html) {
      const body = el('div', null, 'invoice-body');
      body.appendChild(OL.invoiceFragment(r.html, document));
      sheet.appendChild(body);
    } else {
      const box = el('div', null, 'missing');
      box.appendChild(el('p', `This invoice couldn't be included${r && r.error ? `: ${r.error}` : '.'} Open it on Amazon and print it separately:`));
      box.appendChild(el('p', OL.invoiceUrl(o, origin)));
      sheet.appendChild(box);
    }
    $('invoices').appendChild(sheet);
  }
})();
