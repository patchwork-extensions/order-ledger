// Storage and payments for the popup and dashboard.
// When a page is opened outside the extension (e.g. straight from disk to preview the design),
// chrome.storage isn't there, so it falls back to generated sample data. Installed copies never use that path.
(function (root) {
  const OL = (root.OL = root.OL || {});
  const hasChrome = typeof chrome !== 'undefined' && !!(chrome.storage && chrome.storage.local);
  OL.previewMode = !hasChrome;

  // ---------- sample data for preview mode ----------
  function sampleOrders() {
    const items = [
      ['USB-C charging cable, 2-pack', 12.99], ['Dishwasher tablets, 90 count', 16.5], ['Field guide to British birds paperback', 14.99],
      ['Wireless earbuds', 39.99], ['Winter gloves', 18], ['Coffee beans, 1 kg', 21.4], ['LED desk lamp', 27.99],
      ['Bin bags, 60 pack', 8.49], ['Kids puzzle, 500 pieces', 11.99], ['Shampoo, 2 x 400 ml', 9.98], ['Running socks, 3 pairs', 12.5],
      ['Bluetooth speaker', 34.99], ['Protein bars, 12 pack', 17.99], ['Kindle paperback: a novel', 8.99], ['Cat litter, 10 L', 13.25]
    ];
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const now = new Date();
    const orders = [];
    for (let back = 0; back < 34; back++) {
      const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
      const n = 6 + Math.floor(rand() * 9) + (d.getMonth() === 10 || d.getMonth() === 11 ? 6 : 0);
      for (let i = 0; i < n; i++) {
        const day = 1 + Math.floor(rand() * 27);
        if (back === 0 && day > now.getDate()) continue;
        const pick = Math.floor(rand() * items.length);
        const [title, basePrice] = items[pick];
        // Prices creep up a little over the 34 months, so the repeat-purchases view has something to show.
        const price = Math.round(basePrice * (1 + (34 - back) * 0.004) * 100) / 100;
        const status = rand() < 0.04 ? 'Refunded' : 'Delivered';
        const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const asin = `B0SAMPLE${String(pick).padStart(2, '0')}`;
        orders.push({ id: `202-${String(1000000 + orders.length).slice(-7)}-${String(4000000 + back * 97 + i).slice(-7)}`, date, total: price, currency: 'GBP', items: [title], products: [{ title, asin }], category: OL.categorize(title), status });
      }
    }
    return OL.mergeOrders([], orders);
  }
  const preview = { orders: null, lastSync: Date.now() - 2 * 60 * 1000, syncState: { status: 'done' }, origin: 'https://www.amazon.co.uk', tags: null };

  OL.store = {
    async get(keys) {
      if (hasChrome) return chrome.storage.local.get(keys);
      if (!preview.orders) {
        preview.orders = sampleOrders();
        // A few Business tags so the tag column and Business filter have something to show.
        preview.tags = Object.fromEntries(preview.orders.filter((o) => /Electronics|Books/.test(o.category)).map((o) => [o.id, 'business']));
      }
      const out = {};
      for (const k of [].concat(keys)) if (k in preview) out[k] = preview[k];
      return out;
    },
    async set(obj) {
      if (hasChrome) return chrome.storage.local.set(obj);
      Object.assign(preview, obj);
    },
    onChange(cb) {
      if (hasChrome) chrome.storage.onChanged.addListener((changes, area) => area === 'local' && cb(changes));
    }
  };

  // ---------- payments (Stripe Payment Link + offline licence key) ----------
  // Unpacked (developer) installs have no update_url; only those honour config.DEV_PLAN.
  const isDevInstall = () => hasChrome && !('update_url' in chrome.runtime.getManifest());

  OL.payments = {
    async isPaid() {
      const { config } = OL;
      if (!hasChrome) {
        const forced = new URLSearchParams(location.search).get('plan') || config.DEV_PLAN;
        if (forced) return forced === 'lifetime';
      } else if (isDevInstall() && config.DEV_PLAN) {
        return config.DEV_PLAN === 'lifetime';
      }
      const { licence } = await OL.store.get('licence');
      return !!(licence && (await OL.verifyLicence(licence, config.LICENCE_PUBLIC_JWK)));
    },
    // Returns { ok: true } or { ok: false, reason }.
    async activate(key) {
      const { config } = OL;
      if (!config.LICENCE_PUBLIC_JWK) return { ok: false, reason: 'Licence checking is not set up in this build yet.' };
      const payload = await OL.verifyLicence(key, config.LICENCE_PUBLIC_JWK);
      if (!payload) return { ok: false, reason: "That key isn't valid. Copy the whole key from your purchase page and try again." };
      await OL.store.set({ licence: String(key).replace(/\s+/g, ''), paidAt: Date.now() });
      return { ok: true };
    },
    canPay: () => !!OL.config.PAYMENT_LINK,
    openPayment() {
      if (OL.config.PAYMENT_LINK) window.open(OL.config.PAYMENT_LINK, '_blank', 'noopener');
    }
  };
})(globalThis);
