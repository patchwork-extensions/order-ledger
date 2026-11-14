// Pure helpers shared by the content script, popup and dashboard. No DOM, no chrome.* calls,
// so they also run under Node for tests.
(function (root) {
  const OL = (root.OL = root.OL || {});

  const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const pad = (n) => String(n).padStart(2, '0');
  const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

  // "11 November 2026" (UK) or "November 11, 2026" (US) anywhere in the text -> "2026-11-11".
  function parseOrderDate(text) {
    if (!text) return null;
    const t = String(text).replace(/\s+/g, ' ');
    const months = MONTH_NAMES.join('|');
    let m = t.match(new RegExp(`\\b(\\d{1,2}) (${months}) (\\d{4})\\b`, 'i'));
    if (m) return iso(+m[3], MONTH_NAMES.indexOf(m[2].toLowerCase()) + 1, +m[1]);
    m = t.match(new RegExp(`\\b(${months}) (\\d{1,2}), (\\d{4})\\b`, 'i'));
    if (m) return iso(+m[3], MONTH_NAMES.indexOf(m[1].toLowerCase()) + 1, +m[2]);
    return null;
  }

  // "£1,234.56" -> { amount: 1234.56, currency: 'GBP' }
  function parseMoney(text) {
    if (!text) return null;
    const m = String(text).match(/([£$€])\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+(?:\.\d{2}))/);
    if (!m) return null;
    const currency = { '£': 'GBP', '$': 'USD', '€': 'EUR' }[m[1]];
    return { amount: Math.round(parseFloat(m[2].replace(/,/g, '')) * 100) / 100, currency };
  }

  function money(amount, currency) {
    const locale = currency === 'USD' ? 'en-US' : 'en-GB';
    return (amount || 0).toLocaleString(locale, { style: 'currency', currency: currency || 'GBP' });
  }

  // Keyword rules, checked in order. Amazon order pages don't show categories, so this is a best guess.
  const CATEGORY_RULES = [
    ['Books and Kindle', /\b(kindle|paperback|hardcover|hardback|book|novel|edition|audible)\b/i],
    ['Electronics', /\b(usb|hdmi|charger|charging|cable|headphones?|earbuds?|bluetooth|wireless|speaker|keyboard|mouse|monitor|ssd|laptop|tablet|phone|battery|batteries|adapter|echo|fire tv|router|camera|led)\b/i],
    ['Groceries', /\b(coffee|tea|snack|chocolate|sauce|pasta|rice|cereal|protein|vitamin|supplement|water|juice|biscuits?|nuts)\b/i],
    ['Household', /\b(dishwasher|detergent|washing|cleaner|cleaning|toilet|kitchen|bin bags?|sponge|towel|bedding|pillow|duvet|storage|hanger|light bulb|bulbs?|tablets? 90|laundry|soap)\b/i],
    ['Clothing', /\b(shirt|t-shirt|tee|jeans|trousers|dress|jacket|coat|socks|gloves|hat|shoes|trainers|boots|hoodie|jumper|leggings|underwear)\b/i],
    ['Health and beauty', /\b(shampoo|conditioner|toothpaste|toothbrush|razor|moisturi[sz]er|deodorant|skincare|serum|plasters?|paracetamol|ibuprofen)\b/i],
    ['Gifts and toys', /\b(toy|lego|puzzle|game|gift|plush|doll|board game|kids?)\b/i],
    ['Pets', /\b(dog|cat|pet|litter|kibble)\b/i]
  ];

  function categorize(titles) {
    const text = (Array.isArray(titles) ? titles : [titles]).join(' ');
    for (const [name, re] of CATEGORY_RULES) if (re.test(text)) return name;
    return 'Other';
  }

  // First day of the free window, e.g. with 3 months on 13 Nov 2026 -> "2026-09-01".
  function freeWindowStart(now, months) {
    const d = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
    return iso(d.getFullYear(), d.getMonth() + 1, 1);
  }

  function visibleOrders(orders, paid, now, freeMonths) {
    if (paid) return orders.slice();
    const start = freeWindowStart(now, freeMonths);
    return orders.filter((o) => o.date && o.date >= start);
  }

  const countsAsSpend = (o) => o.status !== 'Cancelled' && typeof o.total === 'number';

  // ---------- Periods: calendar years or UK tax years ----------
  // A period is keyed by the year it starts in. A UK tax year runs 6 April to 5 April, so 2025 means 2025/26.
  function periodOf(isoDate, mode) {
    const y = +isoDate.slice(0, 4);
    if (mode !== 'tax') return y;
    return isoDate.slice(5) >= '04-06' ? y : y - 1;
  }
  const periodRange = (year, mode) => (mode === 'tax' ? [iso(year, 4, 6), iso(year + 1, 4, 5)] : [iso(year, 1, 1), iso(year, 12, 31)]);
  const periodLabel = (year, mode) => (mode === 'tax' ? `${year}/${String(year + 1).slice(2)}` : String(year));
  const inPeriod = (o, year, mode) => !!o.date && periodOf(o.date, mode) === year;
  // Which of the 12 chart bars a date falls in. Tax years start with April; 1–5 April at the very end
  // of a tax year is counted with March, its last bar.
  function periodMonthIndex(isoDate, year, mode) {
    const m = +isoDate.slice(5, 7) - 1;
    if (mode !== 'tax') return m;
    return Math.min(11, (+isoDate.slice(0, 4) - year) * 12 + m - 3);
  }
  const rotate = (list, mode) => (mode === 'tax' ? [...list.slice(3), ...list.slice(0, 3)] : list.slice());
  const periodMonths = (mode) => rotate(MONTHS_SHORT, mode);
  const periodMonthsFull = (mode) => rotate(MONTHS_FULL, mode);

  function summarize(orders, monthIndex = (o) => +o.date.slice(5, 7) - 1) {
    const spendOrders = orders.filter(countsAsSpend);
    const total = spendOrders.reduce((s, o) => s + o.total, 0);
    const refunds = orders.filter((o) => o.status === 'Refunded');
    const byMonth = new Array(12).fill(0);
    const byCategory = {};
    for (const o of spendOrders) {
      const month = monthIndex(o);
      byMonth[month] += o.total;
      byCategory[o.category] = (byCategory[o.category] || 0) + o.total;
    }
    const round = (n) => Math.round(n * 100) / 100;
    return {
      total: round(total),
      count: spendOrders.length,
      average: spendOrders.length ? total / spendOrders.length : 0,
      refundCount: refunds.length,
      refundTotal: round(refunds.reduce((s, o) => s + (o.total || 0), 0)),
      byMonth: byMonth.map(round),
      byCategory: Object.entries(byCategory).map(([k, v]) => [k, round(v)]).sort((a, b) => b[1] - a[1])
    };
  }

  // Merge freshly parsed orders into stored ones, keyed by order id. Newest first.
  function mergeOrders(existing, incoming) {
    const map = new Map(existing.map((o) => [o.id, o]));
    for (const o of incoming) map.set(o.id, { ...map.get(o.id), ...o });
    return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  // ---------- Links back to Amazon ----------
  const AMAZON_ORIGIN_RE = /^https:\/\/www\.amazon\.(co\.uk|com)$/;
  const safeOrigin = (origin) => (AMAZON_ORIGIN_RE.test(origin || '') ? origin : 'https://www.amazon.co.uk');

  // The invoice link read off the order card, or the printable invoice built from the order number.
  // Digital orders (D01-…) have their own summary page.
  function invoiceUrl(order, origin) {
    const base = safeOrigin(origin);
    if (order.invoiceUrl && order.invoiceUrl.startsWith('/')) return base + order.invoiceUrl;
    const id = encodeURIComponent(order.id);
    return /^D\d{2}-/.test(order.id)
      ? `${base}/gp/digital/your-account/order-summary.html?orderID=${id}`
      : `${base}/gp/css/summary/print.html?orderID=${id}`;
  }

  const productUrl = (asin, origin) => `${safeOrigin(origin)}/dp/${encodeURIComponent(asin)}`;

  // ---------- Business / Personal tags ----------
  // Tags live under their own storage keys, so re-syncing never touches them:
  //   tags  { [orderId]: 'business' | 'personal' }  set by hand, always wins
  //   rules { [asin]: 'business' }                  "always tag this product Business"
  // An order with no hand-set tag is Business when it contains a product with a rule, else Personal.
  function tagInfo(order, tags, rules) {
    const set = tags && tags[order.id];
    if (set === 'business' || set === 'personal') return { tag: set, auto: false };
    const hit = !!rules && Array.isArray(order.products) && order.products.some((p) => p.asin && rules[p.asin] === 'business');
    return { tag: hit ? 'business' : 'personal', auto: hit };
  }
  const tagOf = (order, tags, rules) => tagInfo(order, tags, rules).tag;
  const filterByTag = (orders, tags, which, rules) => (which === 'business' || which === 'personal' ? orders.filter((o) => tagOf(o, tags, rules) === which) : orders.slice());

  // Business orders in a period that have something to show a receipt for (cancelled orders have none).
  const receiptOrders = (orders, tags, rules, year, mode) =>
    orders.filter((o) => inPeriod(o, year, mode) && o.status !== 'Cancelled' && tagOf(o, tags, rules) === 'business');

  // ---------- Repeat purchases ----------
  // Groups items bought in two or more orders by ASIN. When the order held only that item, its unit
  // price is what was actually paid: the order total (after Subscribe & Save and other discounts,
  // including any delivery) divided by the quantity. In orders with several items it's the item price
  // from the card, when Amazon showed one. Cancelled and refunded orders are left out.
  function repeatPurchases(orders) {
    const round = (n) => Math.round(n * 100) / 100;
    const groups = new Map();
    for (const o of orders) {
      if (o.status === 'Cancelled' || o.status === 'Refunded' || !Array.isArray(o.products)) continue;
      const single = o.products.length === 1;
      const inOrder = new Set();
      for (const p of o.products) {
        if (!p.asin || inOrder.has(p.asin)) continue;
        inOrder.add(p.asin);
        const qty = p.qty || 1;
        let unit = null;
        let source = null;
        if (single && typeof o.total === 'number') { unit = round(o.total / qty); source = 'order'; }
        else if (typeof p.price === 'number') { unit = p.price; source = 'item'; }
        if (!groups.has(p.asin)) groups.set(p.asin, []);
        groups.get(p.asin).push({ orderId: o.id, date: o.date, title: p.title, qty, unit, source });
      }
    }
    const out = [];
    for (const [asin, buys] of groups) {
      if (buys.length < 2) continue;
      buys.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      const priced = buys.filter((b) => b.unit != null);
      const first = priced[0];
      const last = priced[priced.length - 1];
      const hasChange = priced.length >= 2 && first.date !== last.date && first.unit > 0;
      out.push({
        asin,
        title: buys[buys.length - 1].title,
        count: buys.length,
        units: buys.reduce((s, b) => s + b.qty, 0),
        firstDate: buys[0].date,
        lastDate: buys[buys.length - 1].date,
        spent: priced.length ? round(priced.reduce((s, b) => s + b.unit * b.qty, 0)) : null,
        pricedCount: priced.length,
        firstPrice: first ? first.unit : null,
        lastPrice: last ? last.unit : null,
        change: hasChange ? (last.unit - first.unit) / first.unit : null,
        fromOrderTotals: priced.some((b) => b.source === 'order')
      });
    }
    return out.sort((a, b) => b.count - a.count || (a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : 0));
  }

  // ---------- Receipt pack: reading an Amazon order summary ----------
  // Takes the invoice page as text lines (sanitize.js turns the saved copy into lines) plus the order we
  // already know, and pulls out what a receipt needs. Returns null when there's no grand total to be
  // sure of, so the pack falls back to the plain copy. Shaped on real amazon.co.uk pages (Nov 2026):
  // labels and amounts can be on one line ("Total: £9.39") or on two ("Total:" then "£9.39").
  const MONEY_ONLY = /^-?\s?[£$€]\s?[\d,]+\.\d{2}$/;
  function amountOf(s) {
    const m = String(s).match(/(-?)\s?[£$€]\s?([\d,]+\.\d{2})/);
    return m ? Math.round((m[1] ? -1 : 1) * parseFloat(m[2].replace(/,/g, '')) * 100) / 100 : null;
  }
  const SUMMARY_LABEL = /total|subtotal|vat|tax|postage|packing|delivery|promotion|discount|gift|voucher|reward|points|coupon/i;
  const isSectionStart = (s) => /^(order summary|dispatch to|delivery address|shipping address|recipient|payment method|payment information|order placed|order no\.?|order number)$/i.test(s)
    || /^(delivered|dispatched|arriving|refunded|returned|cancelled|out for delivery)\b/i.test(s);

  function parseInvoiceLines(rawLines, order = {}) {
    const lines = rawLines.map((s) => String(s).replace(/\s+/g, ' ').trim()).filter(Boolean);
    const linesAfter = (re, max = 8) => {
      const i = lines.findIndex((s) => re.test(s));
      const out = [];
      if (i < 0) return out;
      for (let j = i + 1; j < lines.length && out.length < max && !isSectionStart(lines[j]); j++) out.push(lines[j]);
      return out;
    };

    const summary = [];
    const add = (label, amount) => {
      label = label.replace(/:$/, '').trim();
      if (!SUMMARY_LABEL.test(label) || label.length > 40 || amount == null) return;
      if (!summary.some((r) => r.label.toLowerCase() === label.toLowerCase())) summary.push({ label, amount });
    };
    for (let i = 0; i < lines.length; i++) {
      const same = lines[i].match(/^(.{2,40}?):\s*(-?\s?[£$€]\s?[\d,]+\.\d{2})$/);
      if (same) add(same[1], amountOf(same[2]));
      else if (/:$/.test(lines[i]) && MONEY_ONLY.test(lines[i + 1] || '')) { add(lines[i], amountOf(lines[i + 1])); i++; }
    }
    const grand = summary.find((r) => /grand total|total for this order|order total/i.test(r.label)) || summary.filter((r) => /^total$/i.test(r.label)).pop();
    if (!grand) return null;

    let placed = null;
    for (const s of lines) { placed = parseOrderDate(s); if (placed) break; }

    const titles = order.items || [];
    const startsWithTitle = (s, t) => s.toLowerCase().startsWith(t.slice(0, 40).toLowerCase());
    const items = titles.map((title) => {
      const item = { title, soldBy: null, price: null };
      const i = lines.findIndex((s) => startsWithTitle(s, title));
      if (i < 0) return item;
      for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
        const s = lines[j];
        if (titles.some((t) => t !== title && startsWithTitle(s, t))) break;
        const seller = s.match(/^Sold by:?\s*(.+)$/i);
        if (seller && !item.soldBy) item.soldBy = seller[1];
        if (item.price == null && MONEY_ONLY.test(s)) item.price = amountOf(s);
      }
      return item;
    });

    return {
      placed: placed || order.date || null,
      dispatchTo: linesAfter(/^(dispatch to|delivery address|shipping address)$/i, 6),
      payment: linesAfter(/^payment method$/i, 3).filter((s) => !/unable to display/i.test(s)),
      status: lines.find((s) => /^(delivered|dispatched|arriving|refunded|returned|cancelled)\b/i.test(s)) || null,
      summary,
      grandTotal: grand.amount,
      items
    };
  }

  // ---------- Exports ----------
  const csvCell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csvRows = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  const ukDate = (isoDate) => `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}/${isoDate.slice(0, 4)}`;
  const describe = (o) => {
    const first = (o.items && o.items[0]) || 'Amazon order';
    const more = o.items && o.items.length > 1 ? ` (+${o.items.length - 1} more)` : '';
    return `Amazon: ${first}${more}`;
  };
  const fixed = (n) => n.toFixed(2);

  const EXPORTS = {
    csv: {
      label: 'CSV spreadsheet',
      hint: 'Every order with date, items, total, status, tag and a link to its invoice. Opens in Excel or Google Sheets.',
      build(orders, { origin, tags, rules } = {}) {
        const rows = [['Order date', 'Order number', 'Items', 'Category', 'Total', 'Currency', 'Status', 'Tag', 'Invoice URL']];
        for (const o of orders) {
          rows.push([o.date, o.id, (o.items || []).join(' | '), o.category, o.total != null ? fixed(o.total) : '', o.currency || '', o.status,
            tagOf(o, tags, rules) === 'business' ? 'Business' : 'Personal', invoiceUrl(o, origin)]);
        }
        return csvRows(rows);
      }
    },
    // Xero bank statement import template: *Date, *Amount, Payee, Description, Reference. Spending is negative.
    xero: {
      label: 'Xero bank statement',
      hint: 'A statement file Xero imports, so you can match orders to expenses.',
      build(orders) {
        const rows = [['*Date', '*Amount', 'Payee', 'Description', 'Reference']];
        for (const o of orders.filter(countsAsSpend)) rows.push([ukDate(o.date), fixed(-o.total), 'Amazon', describe(o), o.id]);
        return csvRows(rows);
      }
    },
    // FreeAgent bank statement CSV: three columns, no header: date, amount, description.
    freeagent: {
      label: 'FreeAgent',
      hint: 'The three-column statement file FreeAgent accepts.',
      build(orders) {
        return csvRows(orders.filter(countsAsSpend).map((o) => [ukDate(o.date), fixed(-o.total), `${describe(o)} ${o.id}`]));
      }
    },
    // QuickBooks Online bank upload, three-column layout: Date, Description, Amount.
    quickbooks: {
      label: 'QuickBooks Online',
      hint: 'Date, description and amount, ready for a QuickBooks bank upload.',
      build(orders) {
        const rows = [['Date', 'Description', 'Amount']];
        for (const o of orders.filter(countsAsSpend)) rows.push([ukDate(o.date), `${describe(o)} ${o.id}`, fixed(-o.total)]);
        return csvRows(rows);
      }
    }
  };

  Object.assign(OL, {
    MONTHS_SHORT, MONTHS_FULL, parseOrderDate, parseMoney, money, categorize,
    freeWindowStart, visibleOrders, summarize, mergeOrders, EXPORTS,
    invoiceUrl, productUrl, tagInfo, tagOf, filterByTag, receiptOrders, repeatPurchases, parseInvoiceLines,
    periodOf, periodRange, periodLabel, inPeriod, periodMonthIndex, periodMonths, periodMonthsFull
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = OL;
})(globalThis);
