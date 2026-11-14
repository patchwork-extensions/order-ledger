// Runs on Amazon order-history pages. Amazon fills in order cards with its own scripts after a page
// loads, so plain background fetches only return empty shells. Instead, sync loads each order page
// (year by year, 10 orders a page) in a hidden same-origin frame, waits for Amazon to finish filling
// it in, reads it, and saves the orders to chrome.storage.local. The visible tab stays where it is.
// Nothing is sent anywhere else.
//
// Checked against a real amazon.co.uk account on 13 Nov 2026: 13 years, 34 pages, 188 orders,
// each page ready in about 2–3 seconds.
(function () {
  const OL = globalThis.OL;
  const { config } = OL;
  const PAGE_TIMEOUT_MS = 20000;
  let running = false;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function setSyncState(patch) {
    const { syncState = {} } = await chrome.storage.local.get('syncState');
    await chrome.storage.local.set({ syncState: { ...syncState, ...patch, updatedAt: Date.now() } });
  }

  async function cancelRequested() {
    const { cancelSync } = await chrome.storage.local.get('cancelSync');
    return !!cancelSync;
  }

  function pageUrl(year, startIndex) {
    const u = new URL('/your-orders/orders', location.origin);
    u.searchParams.set('timeFilter', `year-${year}`);
    u.searchParams.set('startIndex', String(startIndex));
    return u.href;
  }

  function makeFrame() {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:900px;visibility:hidden;border:0';
    document.documentElement.appendChild(frame);
    return frame;
  }

  // Load one order page in the frame and wait until every card shows an order number,
  // or the page has settled with no cards (a year with no orders).
  function loadPage(frame, href) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      frame.onload = async () => {
        let doc;
        try {
          doc = frame.contentDocument;
        } catch (e) {
          return reject(new Error('Amazon blocked reading the order page.'));
        }
        if (!doc) return reject(new Error('Amazon blocked reading the order page.'));
        if (/\/ap\/signin/.test(doc.location.pathname)) {
          const err = new Error('Sign in to Amazon, then sync again.');
          err.code = 'SIGNED_OUT';
          return reject(err);
        }
        let lastCount = -1;
        let stableSince = Date.now();
        while (Date.now() - started < PAGE_TIMEOUT_MS) {
          const { count, ready } = OL.cardsReady(doc);
          if (ready) return resolve({ doc, slow: false });
          if (count !== lastCount) {
            lastCount = count;
            stableSince = Date.now();
          }
          if (count === 0 && doc.readyState === 'complete' && Date.now() - stableSince > 4000) return resolve({ doc, slow: false });
          await sleep(300);
        }
        resolve({ doc, slow: true });
      };
      frame.src = href;
    });
  }

  async function sync() {
    if (running) return;
    running = true;
    await chrome.storage.local.remove(['cancelSync', 'pendingSync']);
    const frame = makeFrame();
    try {
      const years = OL.findYears(document, new Date());
      await setSyncState({ status: 'syncing', ordersFound: 0, pages: 0, slowPages: 0, year: null, yearIndex: 0, yearCount: years.length, error: null, startedAt: Date.now() });
      let { orders: stored = [] } = await chrome.storage.local.get('orders');
      let found = 0;
      let pages = 0;
      let slowPages = 0;

      for (let yi = 0; yi < years.length; yi++) {
        const year = years[yi];
        await setSyncState({ year, yearIndex: yi + 1 });
        for (let page = 0; page < config.MAX_PAGES_PER_YEAR; page++) {
          if (await cancelRequested()) {
            await setSyncState({ status: 'cancelled' });
            return;
          }
          const { doc, slow } = await loadPage(frame, pageUrl(year, page * 10));
          pages++;
          if (slow) slowPages++;
          const orders = OL.parseOrdersPage(doc);
          if (orders.length) {
            found += orders.length;
            stored = OL.mergeOrders(stored, orders);
            await chrome.storage.local.set({ orders: stored });
          }
          await setSyncState({ ordersFound: found, pages, slowPages });
          if (OL.findOrderCards(doc).length < 10) break;
          await sleep(config.PAGE_DELAY_MS + Math.random() * 600);
        }
      }
      await chrome.storage.local.set({ lastSync: Date.now(), origin: location.origin });
      await setSyncState({ status: 'done', finishedAt: Date.now() });
    } catch (e) {
      await setSyncState({ status: 'error', error: e.message || 'Something went wrong while reading your orders.' });
    } finally {
      frame.remove();
      running = false;
    }
  }

  // ---------- receipt pack ----------
  // The dashboard stores a receiptJob and opens this page in a background tab. For each Business order,
  // load its invoice in the hidden frame, keep a cleaned copy (sanitize.js) as receipt:<orderId>, and
  // report progress on receiptJob. Same pacing as the sync, and only the orders the user tagged.
  const INVOICE_TIMEOUT_MS = 20000;
  const RECEIPT_JOB_MAX_AGE_MS = 10 * 60 * 1000;

  function textOfDoc(doc) {
    return (doc.body ? doc.body.innerText || doc.body.textContent || '' : '').replace(/\s+/g, ' ');
  }

  // Resolves once the invoice shows its order number and a total, or with ready: false after a timeout.
  function loadInvoice(frame, href, orderId) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      frame.onload = async () => {
        let doc;
        try {
          doc = frame.contentDocument;
        } catch (e) {
          return reject(new Error('Amazon blocked reading the invoice.'));
        }
        if (!doc) return reject(new Error('Amazon blocked reading the invoice.'));
        if (/\/ap\/signin/.test(doc.location.pathname)) {
          const err = new Error('Amazon asked you to sign in again. Sign in, then get the receipts again.');
          err.code = 'SIGNED_OUT';
          return reject(err);
        }
        while (Date.now() - started < INVOICE_TIMEOUT_MS) {
          const text = textOfDoc(doc);
          if (text.includes(orderId) && /total/i.test(text)) return resolve({ doc, ready: true });
          await sleep(300);
        }
        resolve({ doc, ready: false });
      };
      frame.src = href;
    });
  }

  async function updateJob(patch) {
    const { receiptJob } = await chrome.storage.local.get('receiptJob');
    if (!receiptJob) return;
    await chrome.storage.local.set({ receiptJob: { ...receiptJob, ...patch, updatedAt: Date.now() } });
  }

  async function fetchReceipts() {
    if (running) return;
    const { receiptJob: job } = await chrome.storage.local.get('receiptJob');
    if (!job || job.status !== 'pending' || Date.now() - job.createdAt > RECEIPT_JOB_MAX_AGE_MS) return;
    running = true;
    await updateJob({ status: 'running' });
    const frame = makeFrame();
    let done = 0;
    let failed = 0;
    try {
      for (const o of job.orders) {
        const { cancelReceipts } = await chrome.storage.local.get('cancelReceipts');
        if (cancelReceipts) {
          await updateJob({ status: 'cancelled', done, failed });
          return;
        }
        // Always load from this page's own site, so the frame can be read.
        const u = new URL(OL.invoiceUrl(o, 'https://www.amazon.co.uk'));
        let receipt;
        try {
          const { doc, ready } = await loadInvoice(frame, location.origin + u.pathname + u.search, o.id);
          receipt = ready ? { ok: true, html: OL.extractInvoiceHtml(doc) } : { ok: false, error: 'Amazon took too long to show this invoice.' };
        } catch (e) {
          if (e.code === 'SIGNED_OUT') throw e;
          receipt = { ok: false, error: e.message || "Couldn't open this invoice." };
        }
        done++;
        if (!receipt.ok) failed++;
        await chrome.storage.local.set({ [`receipt:${o.id}`]: receipt });
        await updateJob({ done, failed });
        if (done < job.orders.length) await sleep(config.PAGE_DELAY_MS + Math.random() * 600);
      }
      await updateJob({ status: 'done', done, failed });
    } catch (e) {
      await updateJob({ status: 'error', error: e.message || 'Something went wrong while fetching invoices.', done, failed });
    } finally {
      frame.remove();
      running = false;
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (!msg) return;
    if (msg.type === 'ping') reply({ ok: true, origin: location.origin, running });
    if (msg.type === 'start-sync') {
      sync();
      reply({ ok: true });
    }
  });

  // The popup sets pendingSync when it opens this page for the user; start straight away.
  chrome.storage.local.get('pendingSync').then(({ pendingSync }) => {
    if (pendingSync && Date.now() - pendingSync < 5 * 60 * 1000) sync();
    else fetchReceipts();
  });
})();
