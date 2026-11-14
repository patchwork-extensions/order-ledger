// Copies an Amazon invoice page into plain, safe markup for the receipt pack.
// Used twice: in the Amazon tab (content script) to extract each invoice, and again on receipts.html
// before anything is shown. Only text and simple layout survive: no scripts, styles, images, forms,
// links, attributes (except table colspan/rowspan) or Amazon's site navigation.
(function (root) {
  const OL = (root.OL = root.OL || {});

  const KEEP = new Set(['DIV', 'SPAN', 'P', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'B', 'STRONG', 'I', 'EM', 'BR', 'HR', 'UL', 'OL', 'LI', 'SMALL', 'SECTION', 'ARTICLE', 'MAIN']);
  const DROP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'FRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON',
    'SELECT', 'TEXTAREA', 'SVG', 'IMG', 'PICTURE', 'VIDEO', 'AUDIO', 'CANVAS', 'LINK', 'META', 'NAV', 'FOOTER', 'HEADER', 'DIALOG']);
  // Amazon's site furniture around an order page: menus, footer, recommendations, cookie banner, popovers.
  // Checked on real amazon.co.uk invoices (14 Nov 2026): the print view and the digital order-details page.
  const FURNITURE = '#navbar, #nav-main, #navbar-main, #nav-belt, #nav-subnav, #navFooter, .navLeftFooter, #rhf, #sp-cc, #skiplink, ' +
    '.a-popover, .a-declarative[data-action="a-popover"], [role="navigation"], [role="banner"], [role="contentinfo"], [aria-hidden="true"], ' +
    '.a-breadcrumb, [class*="breadcrumb"], .a-button, .a-button-stack, .a-button-group';
  const MAX_HTML = 400000;

  // Returns a DocumentFragment, owned by `target`, holding a cleaned copy of `src`'s children.
  // `live` is true when reading a rendered page, so hidden elements can be skipped.
  function clean(src, target, live) {
    const out = target.createDocumentFragment();
    const view = live ? src.ownerDocument.defaultView : null;
    for (const node of src.childNodes) {
      if (node.nodeType === 3) {
        out.appendChild(target.createTextNode(node.nodeValue));
        continue;
      }
      if (node.nodeType !== 1) continue;
      const tag = node.tagName.toUpperCase();
      if (DROP.has(tag) || node.hidden) continue;
      if (node.matches && node.matches(FURNITURE)) continue;
      if (view) {
        const style = view.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
      }
      const kids = clean(node, target, live);
      if (!KEEP.has(tag)) {
        // Unknown elements (links, fonts, custom tags) are unwrapped: their text is kept, the element isn't.
        out.appendChild(kids);
        if (tag === 'A' || tag === 'LABEL') out.appendChild(target.createTextNode(' '));
        continue;
      }
      const el = target.createElement(tag.toLowerCase());
      if (tag === 'TD' || tag === 'TH') {
        for (const a of ['colspan', 'rowspan']) {
          const v = node.getAttribute(a);
          if (v && /^\d{1,2}$/.test(v)) el.setAttribute(a, v);
        }
      }
      el.appendChild(kids);
      out.appendChild(el);
    }
    return out;
  }

  // The part of an invoice page worth keeping: Amazon's print view or order-details box, else the page.
  function invoiceRoot(doc) {
    return doc.querySelector('#pos_view_section, #orderDetails, [data-component="orderDetails"]') || doc.querySelector('#a-page') || doc.body;
  }

  // In the Amazon tab: a rendered invoice page -> cleaned HTML string, ready to store.
  function extractInvoiceHtml(doc) {
    const box = doc.createElement('div');
    box.appendChild(clean(invoiceRoot(doc), doc, true));
    // Drop empty wrappers left behind by removed furniture.
    for (const el of [...box.querySelectorAll('div, span, p, section')].reverse()) {
      if (!el.textContent.trim() && !el.querySelector('br, hr')) el.remove();
    }
    return box.innerHTML.replace(/\s{2,}/g, ' ').slice(0, MAX_HTML);
  }

  // On receipts.html: stored HTML string -> safe fragment for `target`. The string is parsed inertly
  // (DOMParser runs no scripts) and cleaned again, so nothing stored can add behaviour to the page.
  function invoiceFragment(html, target) {
    const parsed = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html');
    return clean(parsed.body, target, false);
  }

  // A saved invoice -> its text as lines, one per block (paragraph, list item, table cell, heading),
  // for OL.parseInvoiceLines. Parsed inertly; nothing is rendered.
  const BLOCK = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'TR', 'TD', 'TH', 'TABLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SECTION', 'ARTICLE', 'MAIN', 'BR', 'HR']);
  function invoiceLines(html) {
    const body = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html').body;
    const lines = [];
    let current = '';
    const flush = () => {
      const t = current.replace(/\s+/g, ' ').trim();
      if (t) lines.push(t);
      current = '';
    };
    (function walk(node) {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) current += child.nodeValue;
        else if (child.nodeType === 1) {
          const block = BLOCK.has(child.tagName);
          if (block) flush();
          walk(child);
          if (block) flush();
        }
      }
    })(body);
    flush();
    return lines;
  }

  Object.assign(OL, { extractInvoiceHtml, invoiceFragment, invoiceLines, cleanInvoiceNode: clean });
})(globalThis);
