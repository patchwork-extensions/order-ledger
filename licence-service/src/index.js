// Licence service for all our extensions (Cloudflare Worker).
// Every Stripe Payment Link sends buyers to /claim?session_id=cs_... after paying. This checks the session
// with Stripe, looks up which extension that Payment Link sells, then signs and shows a licence key the
// extension can verify offline. One worker, one key pair and one /claim address serve every extension;
// each extension only accepts keys whose `product` matches its own.
//
// Secrets (wrangler secret put ...):
//   STRIPE_SECRET_KEY      rk_live_... (a restricted key with read access to Checkout Sessions)
//   LICENCE_PRIVATE_JWK    the private JWK printed by tools/make-keys.mjs
// Variables (wrangler.toml [vars]):
//   PRODUCTS               which Payment Link sells which extension:
//                          { "plink_…": { "product": "order-ledger", "name": "Order Ledger", "plan": "lifetime" } }
//                          (a JSON string or a TOML table). Payments through any other link are refused.
//   SUPPORT_EMAIL          shown on error pages
//   ACTIVATIONS_PER_KEY    how many browsers one key can be activated in (default 1)
// Storage (wrangler.toml [[kv_namespaces]]):
//   ACTIVATIONS            one record per activated key, under key:<SHA-256 of the key>, holding only the
//                          random browser IDs it was activated in and when. No email, no key.
//
// POST /activate { key, device } is the one request an extension makes: the first time a key is
// activated. It answers { ok: true } for a valid key in a new or already-registered browser, and
// { ok: false, reason: 'used' | 'invalid' } otherwise. After that the extension checks the key offline.
// To let a customer re-activate (new computer, reinstall), delete the record:
//   node key-id.mjs <their key>   prints the exact wrangler command.

const ALG = { name: 'ECDSA', namedCurve: 'P-256' };
const SIG = { name: 'ECDSA', hash: 'SHA-256' };

const toB64u = (bytes) => {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export async function signLicence(payload, privateJwk) {
  const priv = await crypto.subtle.importKey('jwk', privateJwk, ALG, false, ['sign']);
  const body = toB64u(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign(SIG, priv, new TextEncoder().encode(body));
  return `${body}.${toB64u(sig)}`;
}

// ---------- one-time activation ----------
const fromB64u = (str) => {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};

// The licence key's payload if its signature is ours, else null. Uses the public half of the signing key.
export async function readLicence(key, privateJwk) {
  try {
    const [body, sig] = String(key).split('.');
    if (!body || !sig) return null;
    const { kty, crv, x, y } = privateJwk;
    const pub = await crypto.subtle.importKey('jwk', { kty, crv, x, y }, ALG, false, ['verify']);
    if (!(await crypto.subtle.verify(SIG, pub, fromB64u(sig), new TextEncoder().encode(body)))) return null;
    return JSON.parse(new TextDecoder().decode(fromB64u(body)));
  } catch (_) {
    return null;
  }
}

// Where a key's activations are stored: a hash, so the stored record can't be turned back into a key.
export async function activationId(key) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(key).replace(/\s+/g, '')));
  return 'key:' + [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });

async function activate(request, env) {
  if (!env.ACTIVATIONS) return json({ ok: false, reason: 'unavailable' }, 503);
  let input;
  try {
    input = await request.json();
  } catch (_) {
    return json({ ok: false, reason: 'bad-request' }, 400);
  }
  const key = String((input && input.key) || '').replace(/\s+/g, '');
  const device = String((input && input.device) || '');
  if (!key || key.length > 2000 || !/^[A-Za-z0-9-]{16,64}$/.test(device)) return json({ ok: false, reason: 'bad-request' }, 400);

  const payload = await readLicence(key, JSON.parse(env.LICENCE_PRIVATE_JWK));
  if (!payload) return json({ ok: false, reason: 'invalid' }, 400);

  const id = await activationId(key);
  const limit = Math.max(1, parseInt(env.ACTIVATIONS_PER_KEY || '1', 10) || 1);
  const record = JSON.parse((await env.ACTIVATIONS.get(id)) || '{"devices":[]}');
  if (record.devices.includes(device)) return json({ ok: true, product: payload.product });
  if (record.devices.length >= limit) return json({ ok: false, reason: 'used' }, 409);
  record.devices.push(device);
  record.at = record.at || new Date().toISOString();
  await env.ACTIVATIONS.put(id, JSON.stringify(record));
  return json({ ok: true, product: payload.product });
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// PRODUCTS may arrive as a JSON string or, from a TOML table, as an object. null means it's malformed.
function productsFrom(env) {
  const raw = env.PRODUCTS;
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function page(title, bodyHtml, status = 200, brand = 'Licence') {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${esc(brand)}</title>
<style>
body{margin:0;background:#F7F7F5;color:#16181D;font:16px/1.5 "Segoe UI",system-ui,-apple-system,sans-serif}
main{max-width:560px;margin:48px auto;padding:0 16px}
.card{background:#fff;border:1px solid #E6E7EA;border-radius:16px;padding:28px}
h1{font-size:26px;margin:0 0 8px}
p{margin:0 0 14px;color:#5B616E}
textarea{width:100%;box-sizing:border-box;height:120px;border:1px solid #D4D6DB;border-radius:10px;padding:12px;font:13px ui-monospace,Consolas,monospace;color:#16181D;resize:vertical}
button{margin-top:12px;height:44px;padding:0 18px;border:0;border-radius:10px;background:#1D4ED8;color:#fff;font:600 15px inherit;cursor:pointer}
ol{padding-left:20px;color:#16181D}
</style></head><body><main><div class="card">${bodyHtml}</div></main></body></html>`;
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex' }
  });
}

const help = (env) => (env.SUPPORT_EMAIL ? ` If this keeps happening, email ${esc(env.SUPPORT_EMAIL)}.` : '');

async function claim(url, env, fetchImpl) {
  const sid = url.searchParams.get('session_id') || '';
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sid)) {
    return page('Link not recognised', `<h1>We couldn't read that link</h1><p>Open the link from your payment confirmation page again.${help(env)}</p>`, 400);
  }
  const res = await fetchImpl(`https://api.stripe.com/v1/checkout/sessions/${sid}`, {
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
  });
  if (!res.ok) {
    return page('Payment not found', `<h1>We couldn't find that payment</h1><p>Wait a minute and refresh this page.${help(env)}</p>`, 404);
  }
  const session = await res.json();
  if (session.payment_status !== 'paid') {
    return page('Payment not complete', `<h1>Your payment hasn't gone through yet</h1><p>Refresh this page in a minute.${help(env)}</p>`, 402);
  }
  const products = productsFrom(env);
  if (!products) {
    return page('Not set up', `<h1>The licence service isn't set up correctly</h1><p>Your payment went through. Please email us and we'll send your key.${help(env)}</p>`, 500);
  }
  const product = products[session.payment_link];
  if (!product || !product.product) {
    return page('Wrong product', `<h1>This payment isn't for one of our extensions</h1><p>${help(env).trim()}</p>`, 403);
  }
  const name = product.name || product.product;

  const key = await signLicence(
    {
      product: product.product,
      plan: product.plan || 'lifetime',
      email: (session.customer_details && session.customer_details.email) || '',
      ref: session.id.slice(-12),
      iat: session.created || Math.floor(Date.now() / 1000)
    },
    JSON.parse(env.LICENCE_PRIVATE_JWK)
  );

  return page('Your licence key', `
<h1>Thanks! Here's your ${esc(name)} licence key</h1>
<p>Keep a copy somewhere safe, like your password manager.</p>
<label for="key" style="font-weight:600;display:block;margin-bottom:6px">Licence key</label>
<textarea id="key" readonly>${esc(key)}</textarea>
<button type="button" id="copy">Copy key</button>
<ol>
  <li>Open ${esc(name)} and its upgrade screen.</li>
  <li>Choose <b>Already paid? Enter your licence key</b>.</li>
  <li>Paste the key and press <b>Activate</b>.</li>
</ol>
<script>
document.getElementById('copy').addEventListener('click', async (e) => {
  const t = document.getElementById('key');
  try { await navigator.clipboard.writeText(t.value); } catch (_) { t.select(); document.execCommand('copy'); }
  e.target.textContent = 'Copied';
});
</script>`, 200, name);
}

export default {
  async fetch(request, env, ctx, fetchImpl = fetch) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/claim') return claim(url, env, fetchImpl);
    if (url.pathname === '/activate') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      if (request.method === 'POST') return activate(request, env);
      return json({ ok: false, reason: 'bad-request' }, 405);
    }
    return new Response('Licence service', { status: 200, headers: { 'content-type': 'text/plain' } });
  }
};
