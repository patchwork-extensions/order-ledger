// Offline licence keys. A key is base64url(JSON payload) + "." + base64url(ECDSA P-256 signature).
// The claim worker signs keys with the private key; the extension checks them with the public key in config.js.
// Checking needs no network, so the extension still makes no outside requests.
(function (root) {
  const OL = (root.OL = root.OL || {});
  const ALG = { name: 'ECDSA', namedCurve: 'P-256' };
  const SIG = { name: 'ECDSA', hash: 'SHA-256' };

  const toB64u = (bytes) => {
    let bin = '';
    for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const fromB64u = (str) => {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
    const bin = atob(b64);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  };

  async function verifyLicence(key, publicJwk) {
    if (!key || !publicJwk) return null;
    try {
      const [body, sig] = String(key).replace(/\s+/g, '').split('.');
      if (!body || !sig) return null;
      const pub = await crypto.subtle.importKey('jwk', publicJwk, ALG, false, ['verify']);
      const ok = await crypto.subtle.verify(SIG, pub, fromB64u(sig), new TextEncoder().encode(body));
      if (!ok) return null;
      const payload = JSON.parse(new TextDecoder().decode(fromB64u(body)));
      return payload.product === 'order-ledger' && payload.plan === 'lifetime' ? payload : null;
    } catch (_) {
      return null;
    }
  }

  // Used by the worker and the tests. The extension never has the private key.
  async function signLicence(payload, privateJwk) {
    const priv = await crypto.subtle.importKey('jwk', privateJwk, ALG, false, ['sign']);
    const body = toB64u(new TextEncoder().encode(JSON.stringify(payload)));
    const sig = await crypto.subtle.sign(SIG, priv, new TextEncoder().encode(body));
    return `${body}.${toB64u(sig)}`;
  }

  Object.assign(OL, { verifyLicence, signLicence });
  if (typeof module !== 'undefined' && module.exports) module.exports = { verifyLicence, signLicence };
})(globalThis);
