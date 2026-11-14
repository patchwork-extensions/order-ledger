// Turns an Amazon order-history page (a parsed Document) into plain order objects.
// Amazon changes this markup often, so every lookup has fallbacks and works from text where it can.
(function (root) {
  const OL = (root.OL = root.OL || {});

  const CARD_SELECTORS = ['.order-card', '.js-order-card', '#ordersContainer > .order', '.your-orders-content-container .order'];
  const ORDER_ID_RE = /\b(\d{3}-\d{7}-\d{7}|D\d{2}-\d{7}-\d{7})\b/;
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

  // Real order cards embed large <script> blocks, so their code must not count as text.
  const NON_TEXT = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

  // Visible text of an element with a space between every text node, so "<span>placed</span><span>11 November</span>"
  // reads "placed 11 November" rather than "placed11 November".
  function textOf(el) {
    if (!el) return '';
    const doc = el.ownerDocument;
    const walker = doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
    const parts = [];
    while (walker.nextNode()) {
      if (!NON_TEXT.has(walker.currentNode.parentNode.nodeName)) parts.push(walker.currentNode.nodeValue);
    }
    return clean(parts.join(' '));
  }

  function findOrderCards(doc) {
    for (const sel of CARD_SELECTORS) {
      const found = [...doc.querySelectorAll(sel)];
      // Keep only outermost matches so nested wrappers don't double-count.
      const outer = found.filter((el) => !found.some((other) => other !== el && other.contains(el)));
      if (outer.length) return outer;
    }
    return [];
  }

  // Amazon's own status line for each shipment ("Delivered 12 November", "Refund issued", "Arriving tomorrow").
  const STATUS_SELECTORS = '.delivery-box__primary-text, .yohtmlc-shipment-status-primaryText, .shipment-top-row .a-text-bold';

  // Every card has buttons like "Return or replace items" and lines like "Return window closed",
  // so only specific phrases count as a refund.
  function classifyStatus(text) {
    if (/\brefund(ed|\s+issued|\s+complete)\b|\breturn\s+(complete|received)\b|\breturned\b/i.test(text)) return 'Refunded';
    if (/\bcancell?ed\b/i.test(text)) return 'Cancelled';
    if (/\bdelivered\b/i.test(text)) return 'Delivered';
    return 'Ordered';
  }

  function parseStatus(card, cardText) {
    const lines = [...card.querySelectorAll(STATUS_SELECTORS)].map(textOf).filter(Boolean);
    return classifyStatus(lines.length ? lines.join(' | ') : cardText);
  }

  // True once Amazon's scripts have filled in every card on the page (each shows an order number).
  function cardsReady(doc) {
    const cards = findOrderCards(doc);
    return { count: cards.length, ready: cards.length > 0 && cards.every((c) => ORDER_ID_RE.test(textOf(c))) };
  }

  function parseCard(card) {
    const text = textOf(card);
    const idMatch = text.match(ORDER_ID_RE);
    if (!idMatch) return null;

    const header = card.querySelector('.order-header, .a-box.order-info, .order-info') || card;
    const headerText = textOf(header);
    const date = OL.parseOrderDate(headerText) || OL.parseOrderDate(text);
    const totalMatch = headerText.match(/Total\s*([£$€]\s?[\d,]+\.\d{2})/i);
    const money = OL.parseMoney(totalMatch ? totalMatch[1] : headerText);

    const products = parseProducts(card, header);
    const items = products.map((p) => p.title);

    // Some older orders show no status line at all; once they're a month old, call them completed.
    let status = parseStatus(card, text);
    if (status === 'Ordered' && date && Date.now() - new Date(date + 'T12:00:00').getTime() > 30 * 24 * 3600 * 1000) status = 'Completed';

    return {
      id: idMatch[1],
      date,
      total: money ? money.amount : null,
      currency: money ? money.currency : null,
      items,
      products,
      invoiceUrl: findInvoicePath(card),
      category: OL.categorize(items),
      status
    };
  }

  // ---------- items: title, ASIN, and price/quantity when the card shows them ----------
  // Physical items link to their product page (/dp/…). Digital items (Kindle, apps, Luna) sit in the
  // same title block but link to the order-details page, so they have a name and no ASIN.
  // Checked on a real amazon.co.uk account on 14 Nov 2026: list cards show no per-item price.
  const PRODUCT_LINKS = 'a[href*="/dp/"], a[href*="/gp/product/"], .yohtmlc-product-title a';
  const ASIN_RE = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?=[/?#]|$)/i;
  const asinOf = (href) => {
    const m = (href || '').match(ASIN_RE);
    return m ? m[1].toUpperCase() : null;
  };
  const productKey = (a) => asinOf(a.getAttribute('href')) || textOf(a);

  // The largest block around one item's link that holds no other item and no order header,
  // so a price found inside it belongs to that item.
  function itemBox(link, card, header) {
    const key = productKey(link);
    let box = link;
    for (let el = link.parentElement; el && el !== card; el = el.parentElement) {
      if (el.contains(header)) break;
      const others = [...el.querySelectorAll(PRODUCT_LINKS)].some((a) => { const k = productKey(a); return k && k !== key; });
      if (others) break;
      box = el;
    }
    return box;
  }

  const PRICE_SELECTORS = '.a-price .a-offscreen, .a-color-price, .yohtmlc-item-price, [class*="item-price"], [class*="unit-price"]';
  function priceIn(box) {
    for (const el of box.querySelectorAll(PRICE_SELECTORS)) {
      const m = OL.parseMoney(el.textContent);
      if (m) return m.amount;
    }
    return null;
  }

  // Amazon shows a small quantity badge on the item image when more than one was bought.
  function qtyIn(box) {
    for (const el of box.querySelectorAll('[class*="qty"], [class*="quantity"]')) {
      const m = textOf(el).match(/^(?:qty:?\s*)?(\d{1,2})$/i);
      if (m && +m[1] > 0) return +m[1];
    }
    return null;
  }

  function parseProducts(card, header) {
    const seen = new Set();
    const products = [];
    for (const a of card.querySelectorAll(PRODUCT_LINKS)) {
      const title = textOf(a);
      if (title.length < 4 || seen.has(title)) continue;
      seen.add(title);
      const box = itemBox(a, card, header);
      const product = { title, asin: asinOf(a.getAttribute('href')) };
      const price = priceIn(box);
      const qty = qtyIn(box);
      if (price != null) product.price = price;
      if (qty != null) product.qty = qty;
      products.push(product);
    }
    return products;
  }

  // ---------- invoice link ----------
  // Only Amazon paths are kept (path + query), so a stored link can't point anywhere else.
  // The newer layout's "View invoice" opens a popover fragment rather than a page; skip it and let
  // OL.invoiceUrl build the printable invoice address from the order number instead.
  function findInvoicePath(card) {
    for (const a of card.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      if (!/invoice/i.test(textOf(a) + ' ' + href) || /popover/i.test(href)) continue;
      try {
        const u = new URL(href, 'https://www.amazon.co.uk');
        if (!/^https:$/.test(u.protocol) || !/(^|\.)amazon\.(co\.uk|com)$/i.test(u.hostname)) continue;
        return u.pathname + u.search;
      } catch (_) { /* malformed href */ }
    }
    return null;
  }

  function parseOrdersPage(doc) {
    return findOrderCards(doc).map(parseCard).filter((o) => o && o.date);
  }

  // Years offered in the time filter dropdown, newest first.
  function findYears(doc, now) {
    const years = new Set();
    for (const opt of doc.querySelectorAll('option, [data-value], a')) {
      const v = opt.getAttribute('value') || opt.getAttribute('data-value') || opt.getAttribute('href') || '';
      const m = v.match(/year-(\d{4})/);
      if (m) years.add(+m[1]);
    }
    if (!years.size) for (let y = now.getFullYear(); y > now.getFullYear() - 5; y--) years.add(y);
    return [...years].sort((a, b) => b - a);
  }

  // "214 orders placed in 2025" -> 214
  function findOrderCount(doc) {
    const el = doc.querySelector('.num-orders, .num-orders-for-orders-by-date');
    // The count usually sits in a span ("214 orders") followed by " placed in", so read the parent's text.
    const scope = el ? el.parentElement || el : doc.body;
    const m = textOf(scope).match(/(\d[\d,]*)\s+orders?\s+placed/i);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
  }

  Object.assign(OL, { parseOrdersPage, findYears, findOrderCount, parseCard, findOrderCards, cardsReady, classifyStatus });
})(globalThis);
