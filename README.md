# Order Ledger: how it handles your data

Order Ledger is a Chrome extension that reads your amazon.co.uk order history and shows what you spend, lets you tag business purchases, and exports them for your accounts. It's made by Patchwork Labs.

This repository holds its code so you can check what it does with your data, instead of taking our word for it. It's published for review, not for reuse: see [LICENSE](LICENSE).

## The short version

- **Your orders never leave your computer.** They're saved in Chrome's own storage on your machine. There is no Order Ledger server that receives them.
- **No account, no tracking, no analytics.** The extension doesn't send anything about you or your orders anywhere.
- **It only runs on Amazon's order-history pages.** It can't see other websites or your other tabs.
- **Buying Lifetime shares one thing with us: the email you pay with**, which Stripe passes on so we can make your licence key. We don't keep a copy.
- **One request to our server, once:** when you activate your key, so each key works in one browser. Details below.

## What it reads, and where it keeps it

When you press **Sync**, the extension opens your Amazon order-history pages, year by year, in a hidden frame inside your Amazon tab: the same pages you'd open yourself, while you're signed in. From each order it saves:

- date, order number, total and currency
- item names and Amazon product numbers (ASINs)
- delivery status, and the address of the order's invoice page

These go into `chrome.storage.local` on your computer, along with your own settings: Business/Personal tags, products you chose to always tag Business, and calendar or tax-year view. Removing the extension deletes all of it.

It does **not** read or save your Amazon password, payment cards, or delivery address from the order list.

### Receipt packs

If you make a receipt pack, the extension opens the invoice page for each order you tagged Business, one at a time in a background Amazon tab, and saves a plain-text copy on your computer to build the pack. Invoice pages do show your delivery address and the last digits of your card, so those appear in your pack, just as on Amazon's own invoice. The copies stay on your computer and are replaced the next time you make a pack. See [`extension/content.js`](extension/content.js) and [`extension/sanitize.js`](extension/sanitize.js).

## Permissions

From [`extension/manifest.json`](extension/manifest.json):

| Permission | Why |
|---|---|
| `storage` | Save your orders and settings on your computer. |
| `unlimitedStorage` | Room for receipt packs. No extra access; it only raises the storage limit. |
| Content script on `amazon.co.uk/your-orders/*` and the older order-history addresses (and the amazon.com equivalents) | Read your order list. It runs on those pages and nowhere else. |

It asks for no access to your browsing history, other sites, downloads or tabs.

## Network requests

Apart from one request when you activate a licence key (below), the extension makes **no requests to any server of ours, or to anyone else's**. The only pages it loads are Amazon's own order and invoice pages, inside your Amazon tab.

Things you click can open other sites in a new tab: an order's invoice on Amazon, "View on Amazon", the Stripe checkout when you buy, and, only if one is shown, a clearly labelled partner offer next to Export.

## Buying Lifetime

1. **Unlock** opens a Stripe checkout page. Your card details go to Stripe, never to us. ([Stripe's privacy policy](https://stripe.com/gb/privacy))
2. After paying, Stripe sends you to our licence service ([`licence-service/src/index.js`](licence-service/src/index.js)), which runs on Cloudflare. It asks Stripe whether that checkout was paid and for the email used, then signs a licence key and shows it to you. **It stores nothing**: no database, no copy of your key or email. Cloudflare may keep standard request logs.
3. You paste the key into Order Ledger. The extension checks its signature with a public key built into [`extension/config.js`](extension/config.js). See [`extension/licence.js`](extension/licence.js). The key contains your email so you can prove it's yours.
4. **Once**, the extension sends the key and a random ID for your browser to the licence service's `/activate` address, so a key can only be used in one browser. The service stores a fingerprint (SHA-256 hash) of the key, the browser ID and the date: not the key, not your email, nothing about your orders. See `activate()` in [`licence-service/src/index.js`](licence-service/src/index.js) and `activate()` in [`extension/store.js`](extension/store.js). After that the key is only checked offline. If you move to a new computer, email us and we'll reset it.

The licence service's secrets (the Stripe key and the key-signing key) are stored in Cloudflare, not in this code.

## Checking your installed copy matches this code

Chrome keeps every extension's files on your computer. On Windows they're in
`%LOCALAPPDATA%\Google\Chrome\User Data\Default\Extensions\<extension id>\<version>\`
(on a Mac, `~/Library/Application Support/Google/Chrome/Default/Extensions/`). Compare them with the [`extension/`](extension/) folder here for the same version number. The Web Store adds a small `_metadata` folder; everything else should match.

One difference: in this public copy, `PAYMENT_LINK` in `config.js` is blank until Order Ledger is on sale, so a test checkout link isn't published.

## What's where

| Path | What it is |
|---|---|
| `extension/manifest.json` | Permissions and where the extension runs |
| `extension/content.js` | Runs on Amazon's order pages: the sync and the receipt pack |
| `extension/parser.js` | Reads orders off an order-history page |
| `extension/sanitize.js` | Turns an invoice page into plain text and simple tables for the receipt pack |
| `extension/shared.js` | Sums, tags, tax years and export files; no access to the page or network |
| `extension/store.js`, `extension/licence.js` | Local storage, key activation and the offline licence check |
| `extension/dashboard.*`, `popup.*`, `receipts.*` | What you see |
| `licence-service/` | The Cloudflare service that turns a Stripe payment into a licence key |

## Questions or concerns

Email patchworksupport.6n6ki@silomails.com. If you find something that doesn't match this page, we want to know.

Order Ledger is not affiliated with Amazon.
