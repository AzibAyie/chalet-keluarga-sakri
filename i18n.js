/*
 * Language switch (Bahasa Melayu <-> English) for the *.dc.html pages.
 *
 * Pages are written in Malay. When English is chosen, every visible text,
 * alt/aria-label/placeholder/title attribute and WhatsApp message is swapped
 * using the dictionary in lang-en.js (window.CKS_EN). Text added later by the
 * page scripts (map cards, tooltips, clock) is caught by a MutationObserver.
 * Switching back restores the original Malay exactly.
 *
 * Load order in <head>: lang-en.js, i18n.js, then support.js.
 */
(function () {
  'use strict';

  var STORE = 'cks_lang';
  var DICT = (window.CKS_EN && window.CKS_EN.dict) || {};
  var RULES = (window.CKS_EN && window.CKS_EN.rules) || [];
  var INLINE = { B: 1, STRONG: 1, EM: 1, I: 1, A: 1, SMALL: 1, BR: 1, SPAN: 1, SUP: 1, U: 1 };
  var SKIP = { SCRIPT: 1, STYLE: 1, PLAINTEXT: 1, NOSCRIPT: 1, TEMPLATE: 1, TEXTAREA: 1 };
  var ATTRS = ['alt', 'aria-label', 'placeholder', 'title'];
  var collect = /[?&]i18ncollect\b/.test(location.search) ? (window.__i18nSeen = {}) : null;

  function norm(s) { return s.replace(/\s+/g, ' ').trim(); }

  function tr(k) {
    if (Object.prototype.hasOwnProperty.call(DICT, k)) return DICT[k];
    for (var i = 0; i < RULES.length; i++) {
      var m = k.match(RULES[i][0]);
      if (m) return RULES[i][1](m, T);
    }
    return null;
  }
  function T(s) { var t = tr(norm(s)); return t == null ? s : t; }

  function seen(kind, k) { if (collect && k && !/^[\d\s.,:·+\-–—/%()RMrm]*$/.test(k)) collect[kind + '\u0001' + k] = 1; }

  function initial() {
    var q = location.search.match(/[?&]lang=(en|ms)\b/);
    if (q) return q[1];
    try { var v = localStorage.getItem(STORE); if (v === 'en' || v === 'ms') return v; } catch (e) {}
    return 'ms';
  }
  var lang = initial();

  /* ---------- units ---------- */
  function isHtmlUnit(el) {
    if (el.nodeType !== 1 || SKIP[el.tagName]) return false;
    var hasText = false, hasInline = false;
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) { if (n.data.trim()) hasText = true; }
      else if (n.nodeType === 1) {
        if (!INLINE[n.tagName] || n.querySelector('svg,img,button,input,select,div,p,ul,ol,li,table')) return false;
        // swatches, counters and number badges don't make a sentence: translate the text around them on its own
        if (/[A-Za-zÀ-ɏ]/.test(n.textContent)) hasInline = true;
      }
    }
    return hasText && hasInline;
  }

  function txt(n) {
    var p = n.parentNode;
    if (!p || SKIP[p.nodeName]) return;
    var raw = n.data;
    if (n.__en !== undefined && raw === n.__en) return;
    var k = norm(raw);
    if (!k) return;
    seen('t', k);
    if (lang !== 'en') return;
    var t = tr(k);
    if (t == null || t === k) return;
    var en = raw.match(/^\s*/)[0] + t + raw.match(/\s*$/)[0];
    n.__ms = raw; n.__en = en; n.data = en;
  }

  function html(el) {
    var raw = el.innerHTML;
    if (el.__enHtml !== undefined && raw === el.__enHtml) return;
    var k = norm(raw);
    seen('h', k);
    if (lang !== 'en') { walkKids(el); return; }
    var t = tr(k);
    if (t == null) { walkKids(el); return; }
    el.__msHtml = raw; el.innerHTML = t; el.__enHtml = el.innerHTML;
    walkKids(el, true);
  }
  function walkKids(el, attrsOnly) {
    var all = el.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) attrs(all[i]);
    if (!attrsOnly) for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) txt(n);
  }

  function attrOne(el, name) {
    var v = el.getAttribute(name);
    if (v == null) return;
    el.__msAttr = el.__msAttr || {}; el.__enAttr = el.__enAttr || {};
    if (el.__enAttr[name] !== undefined && v === el.__enAttr[name]) return;
    var en = null;
    if (name === 'href') {
      if (v.indexOf('https://wa.me/') !== 0 || v.indexOf('text=') < 0) return;
      var parts = v.split('text='), msg = decodeURIComponent(parts[1]);
      seen('w', norm(msg));
      if (lang !== 'en') return;
      var tm = tr(norm(msg));
      if (tm != null) en = parts[0] + 'text=' + encodeURIComponent(tm);
    } else {
      var k = norm(v);
      if (!k) return;
      seen('a', k);
      if (lang !== 'en') return;
      en = tr(k);
    }
    if (en == null || en === v) return;
    el.__msAttr[name] = v; el.__enAttr[name] = en;
    el.setAttribute(name, en);
  }
  function attrs(el) {
    for (var i = 0; i < ATTRS.length; i++) if (el.hasAttribute(ATTRS[i])) attrOne(el, ATTRS[i]);
    if (el.tagName === 'A') attrOne(el, 'href');
    if (el.tagName === 'META' && el.getAttribute('name') === 'description') attrOne(el, 'content');
    if (el.hasAttribute('data-lang')) el.setAttribute('aria-pressed', String(el.getAttribute('data-lang') === lang));
  }

  function walk(node) {
    if (node.nodeType === 3) { txt(node); return; }
    if (node.nodeType !== 1 || SKIP[node.tagName]) return;
    attrs(node);
    if (isHtmlUnit(node)) { html(node); return; }
    for (var c = node.firstChild; c; c = c.nextSibling) walk(c);
  }

  function restore() {
    var w = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    var list = [], n;
    while ((n = w.nextNode())) list.push(n);
    list.forEach(function (n) {
      if (n.nodeType === 3) {
        if (n.__en !== undefined && n.data === n.__en) n.data = n.__ms;
        delete n.__en; delete n.__ms;
        return;
      }
      if (n.__enHtml !== undefined && n.innerHTML === n.__enHtml) n.innerHTML = n.__msHtml;
      delete n.__enHtml; delete n.__msHtml;
      if (n.__enAttr) Object.keys(n.__enAttr).forEach(function (a) { if (n.getAttribute(a) === n.__enAttr[a]) n.setAttribute(a, n.__msAttr[a]); });
      delete n.__enAttr; delete n.__msAttr;
      if (n.hasAttribute && n.hasAttribute('data-lang')) n.setAttribute('aria-pressed', String(n.getAttribute('data-lang') === lang));
    });
  }

  /* ---------- observer ---------- */
  var busy = false;
  var mo = new MutationObserver(function (records) {
    if (busy) return;
    busy = true;
    records.forEach(function (m) {
      if (m.type === 'characterData') {
        var p = m.target.parentNode;
        if (p && isHtmlUnit(p)) html(p); else txt(m.target);
      } else if (m.type === 'childList') {
        var p2 = m.target;
        if (p2.nodeType === 1 && isHtmlUnit(p2)) { html(p2); return; }
        m.addedNodes.forEach(function (n) { if (n.parentNode) walk(n); });
      } else if (m.type === 'attributes') {
        attrOne(m.target, m.attributeName);
      }
    });
    mo.takeRecords();
    busy = false;
  });
  mo.observe(document.documentElement, {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ATTRS.concat(['href'])
  });

  /* ---------- switching ---------- */
  function set(l) {
    if (l !== 'en' && l !== 'ms') return;
    lang = l;
    try { localStorage.setItem(STORE, l); } catch (e) {}
    document.documentElement.lang = l === 'en' ? 'en' : 'ms';
    busy = true;
    if (l === 'en') walk(document.documentElement); else restore();
    mo.takeRecords();
    busy = false;
    try { window.dispatchEvent(new CustomEvent('cks:lang', { detail: l })); } catch (e) {}
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-lang]');
    if (b) { e.preventDefault(); set(b.getAttribute('data-lang')); }
  });

  document.documentElement.lang = lang === 'en' ? 'en' : 'ms';
  if (lang === 'en') document.addEventListener('DOMContentLoaded', function () { busy = true; walk(document.head); mo.takeRecords(); busy = false; });

  window.CKS_I18N = { set: set, get: function () { return lang; }, t: T };
})();
