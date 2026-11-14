// Settings you change before publishing.
(function (root) {
  const OL = (root.OL = root.OL || {});

  OL.config = {
    // Your Stripe Payment Link for the one-time Lifetime purchase. Set its "after payment" redirect to
    // https://<your-worker>/claim?session_id={CHECKOUT_SESSION_ID} so buyers get their licence key.
    // TEST-MODE link (sandbox). Swap for the live link before publishing.
    PAYMENT_LINK: '' /* test-mode link left out of the public copy */,
    // Public half of the licence signing key (run `node tools/make-keys.mjs`). Without it, nobody can unlock.
    LICENCE_PUBLIC_JWK: {"kty":"EC","crv":"P-256","x":"pIRAGIJJxpY-pXnwxo6p-oEvzMC3Y9zyOb0G46Au55w","y":"WI2iHadtoEgk7QRwk29iORNY8WO2uD2s4BVOIlV4unQ"},
    // The licence service. Activating a key asks it once whether the key is already in use elsewhere
    // (POST /activate); nothing else is ever sent there. Leave empty to check keys offline only.
    LICENCE_SERVICE: 'https://licence.order-ledger-licence.workers.dev',
    // Where buyers write if they lose their key.
    SUPPORT_EMAIL: 'patchworksupport.6n6ki@silomails.com',
    // Shown in the UI. Keep it in step with the Payment Link price.
    PRICE_LABEL: '£4.99',
    // Developer switch: null, 'free' or 'lifetime'. Only honoured in unpacked (developer) installs
    // and in preview mode, so a store build ignores it.
    DEV_PLAN: null,
    // Free plan: how many calendar months (including this one) are visible.
    FREE_MONTHS: 3,
    // Pause between order-page requests, so syncing looks like a person browsing.
    PAGE_DELAY_MS: 1200,
    // Safety cap per year (10 orders per page).
    MAX_PAGES_PER_YEAR: 60,
    DEFAULT_ORIGIN: 'https://www.amazon.co.uk'
  };

  // Partner offers shown next to Export, labelled as ads. A card only appears once `url` is set,
  // so nothing ships until you've joined a programme and checked its terms allow placement in an extension.
  OL.partners = {
    csv: { name: '', url: '', title: 'Budgeting this year?', body: 'Track Amazon alongside the rest of your spending.', offer: '' },
    xero: { name: 'Xero', url: '', title: 'Self-employed?', body: 'Import these orders into your accounts and claim business purchases.', offer: '' },
    freeagent: { name: 'FreeAgent', url: '', title: 'Doing your self-assessment?', body: 'Import these orders and sort business expenses in minutes.', offer: '' },
    quickbooks: { name: 'QuickBooks', url: '', title: 'Self-employed?', body: 'Import these orders and keep receipts with each expense.', offer: '' }
  };
})(globalThis);
