/*
 * Minimal runtime for the *.dc.html design-canvas pages.
 *
 * Supports what these pages use:
 *   <x-dc> root, <helmet> (moved into <head>), {{expr}} bindings in text and
 *   attributes, on* event bindings, <sc-if value>, <sc-for list as>,
 *   <dc-import name ...props>, and a Component class extending DCLogic
 *   (state, setState, renderVals, componentDidMount/WillUnmount/DidUpdate).
 *
 * Pages must be served over http(s) (e.g. `npx serve`), because imported
 * components (Header, Footer) are loaded with fetch().
 */
(function () {
  'use strict';

  // Everything after this script tag becomes raw text inside <plaintext>,
  // so the browser never parses the unrendered template markup.
  document.write('<plaintext id="__dc_src" style="display:none">');

  class DCLogic {
    constructor(props) {
      this.props = props || {};
      this.state = {};
    }
    setState(update, cb) {
      const patch = typeof update === 'function' ? update(this.state, this.props) : update;
      this.state = Object.assign({}, this.state, patch);
      if (this.__inst) this.__inst.schedule(cb);
      else if (cb) cb();
    }
    forceUpdate(cb) {
      if (this.__inst) this.__inst.schedule(cb);
    }
    renderVals() {
      return {};
    }
  }
  window.DCLogic = DCLogic;

  const DEFS = {};
  const EXPR = /\{\{([^{}]*)\}\}/g;
  const SINGLE = /^\{\{([^{}]*)\}\}$/;

  function lookup(expr, scope) {
    expr = expr.trim();
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (expr === 'null') return null;
    if (expr === 'undefined' || expr === '') return undefined;
    if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
    const q = expr.match(/^(['"])(.*)\1$/);
    if (q) return q[2];
    let v = scope;
    const parts = expr.split('.');
    for (let i = 0; i < parts.length; i++) {
      if (v == null) return undefined;
      v = v[parts[i]];
    }
    return v;
  }

  function interp(tmpl, scope) {
    const m = tmpl.match(SINGLE);
    if (m) return lookup(m[1], scope);
    return tmpl.replace(EXPR, function (_, e) {
      const v = lookup(e, scope);
      return v == null ? '' : String(v);
    });
  }

  function toStr(v) {
    return v == null ? '' : String(v);
  }

  function hasExpr(s) {
    return s != null && s.indexOf('{{') !== -1;
  }

  // ---------- source parsing ----------

  function parseSource(text) {
    const xm = text.match(/<x-dc>([\s\S]*)<\/x-dc>/i);
    let body = xm ? xm[1] : '';
    let helmet = '';
    body = body.replace(/<helmet>([\s\S]*?)<\/helmet>/i, function (_, h) {
      helmet = h;
      return '';
    });
    // <template> survives HTML parsing anywhere (incl. inside <select>) and is inert.
    body = body
      .replace(/<sc-(for|if)\b/gi, '<template data-sc="$1"')
      .replace(/<\/sc-(for|if)>/gi, '</template>');
    const tpl = document.createElement('template');
    tpl.innerHTML = body;

    const sm = text.match(/<script\s+type="text\/x-dc"([^>]*)>([\s\S]*?)<\/script>/i);
    let propDefaults = {};
    let Comp = DCLogic;
    if (sm) {
      const pm = sm[1].match(/data-props='([^']*)'/);
      if (pm) {
        try {
          const defs = JSON.parse(pm[1]);
          Object.keys(defs).forEach(function (k) {
            if (k.charAt(0) !== '$' && defs[k] && 'default' in defs[k]) propDefaults[k] = defs[k].default;
          });
        } catch (e) {
          console.warn('[dc] bad data-props', e);
        }
      }
      Comp = new Function('DCLogic', sm[2] + '\n;return typeof Component !== "undefined" ? Component : DCLogic;')(DCLogic);
    }

    const imports = [];
    const re = /<dc-import\b[^>]*\bname="([^"]+)"/gi;
    let im;
    while ((im = re.exec(body))) if (imports.indexOf(im[1]) === -1) imports.push(im[1]);

    return { helmet: helmet, tpl: tpl, Comp: Comp, propDefaults: propDefaults, imports: imports };
  }

  async function loadImports(def) {
    for (const name of def.imports) {
      if (DEFS[name]) continue;
      try {
        const res = await fetch(name + '.dc.html');
        if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
        DEFS[name] = parseSource(await res.text());
        await loadImports(DEFS[name]);
      } catch (e) {
        DEFS[name] = null;
        console.warn('[dc] could not load component "' + name + '". Serve this folder over http (e.g. `npx serve`).', e);
      }
    }
  }

  const helmetsAdded = new Set();
  function addHelmet(def) {
    const h = def.helmet.trim();
    if (!h || helmetsAdded.has(h)) return;
    helmetsAdded.add(h);
    const tpl = document.createElement('template');
    tpl.innerHTML = h;
    for (const node of Array.from(tpl.content.childNodes)) {
      // A stylesheet shared by several components loads once, in its first position,
      // so it never lands after (and overrides) a page's own styles.
      if (node.nodeName === 'LINK') {
        const href = node.getAttribute('href');
        const dup = Array.from(document.head.querySelectorAll('link')).some(function (l) {
          return l.getAttribute('href') === href && l.getAttribute('rel') === node.getAttribute('rel');
        });
        if (dup) continue;
      }
      if (node.nodeType === 1) document.head.appendChild(document.importNode(node, true));
    }
  }

  // ---------- rendering ----------

  function buildChildren(src, out, ups, inst) {
    for (let n = src.firstChild; n; n = n.nextSibling) buildNode(n, out, ups, inst);
  }

  function buildNode(n, out, ups, inst) {
    if (n.nodeType === 3) {
      const t = document.createTextNode('');
      if (hasExpr(n.data)) {
        const tmpl = n.data;
        ups.push(function (sc) {
          const v = toStr(interp(tmpl, sc));
          if (t.data !== v) t.data = v;
        });
      } else {
        t.data = n.data;
      }
      out.appendChild(t);
      return;
    }
    if (n.nodeType !== 1) return;

    const tag = n.localName;
    if (tag === 'template' && n.hasAttribute('data-sc')) return buildBlock(n, out, ups, inst);
    if (tag === 'dc-import') return buildImport(n, out, inst);

    const el = document.createElementNS(n.namespaceURI, tag);
    const ownUps = [];
    for (const a of Array.from(n.attributes)) {
      if (a.name.indexOf('hint-') === 0) continue;
      if (!hasExpr(a.value)) {
        el.setAttributeNS(a.namespaceURI, a.name, a.value);
        continue;
      }
      bindAttr(el, tag, a.name, a.value, ownUps);
    }
    if (tag === 'template') {
      el.innerHTML = n.innerHTML;
    } else {
      buildChildren(n, el, ups, inst);
    }
    // Own attribute updaters run after children (so <select value> sees its options).
    for (const u of ownUps) ups.push(u);
    out.appendChild(el);
  }

  function bindAttr(el, tag, name, tmpl, ups) {
    if (/^on[a-z]+$/.test(name)) {
      let ev = name.slice(2);
      if (ev === 'change' && (tag === 'input' || tag === 'textarea')) ev = 'input';
      if (ev === 'doubleclick') ev = 'dblclick';
      const holder = { sc: null };
      ups.push(function (sc) { holder.sc = sc; });
      el.addEventListener(ev, function (e) {
        const fn = interp(tmpl, holder.sc);
        if (typeof fn === 'function') fn(e);
      });
      return;
    }
    if (name === 'value' && (tag === 'input' || tag === 'select' || tag === 'textarea')) {
      ups.push(function (sc) {
        const v = toStr(interp(tmpl, sc));
        if (el.value !== v) el.value = v;
      });
      return;
    }
    if (name === 'checked' && tag === 'input') {
      ups.push(function (sc) { el.checked = !!interp(tmpl, sc); });
      return;
    }
    ups.push(function (sc) {
      const v = toStr(interp(tmpl, sc));
      if (el.getAttribute(name) !== v) el.setAttribute(name, v);
    });
  }

  function mountBlock(content, sc, before, inst) {
    const frag = document.createDocumentFragment();
    const ups = [];
    const childStart = inst.children.length;
    buildChildren(content, frag, ups, inst);
    const children = inst.children.splice(childStart);
    for (const u of ups) u(sc);
    const nodes = Array.from(frag.childNodes);
    before.parentNode.insertBefore(frag, before);
    if (inst.mounted) children.forEach(didMountTree);
    else inst.children.push.apply(inst.children, children);
    return { nodes: nodes, ups: ups, children: children };
  }

  function unmountBlock(b) {
    b.children.forEach(willUnmountTree);
    for (const n of b.nodes) if (n.parentNode) n.parentNode.removeChild(n);
  }

  function buildBlock(n, out, ups, inst) {
    const kind = n.getAttribute('data-sc');
    const end = document.createComment('/sc-' + kind);
    out.appendChild(end);
    const content = n.content;

    if (kind === 'if') {
      const expr = n.getAttribute('value') || '';
      let cur = null;
      ups.push(function (sc) {
        if (interp(expr, sc)) {
          if (!cur) cur = mountBlock(content, sc, end, inst);
          else for (const u of cur.ups) u(sc);
        } else if (cur) {
          unmountBlock(cur);
          cur = null;
        }
      });
      return;
    }

    const listExpr = n.getAttribute('list') || '';
    const as = n.getAttribute('as') || 'item';
    const items = [];
    ups.push(function (sc) {
      let list = interp(listExpr, sc);
      list = Array.isArray(list) ? list : list ? Array.from(list) : [];
      list.forEach(function (item, i) {
        const isc = Object.create(sc);
        isc[as] = item;
        isc.index = i;
        if (i < items.length) for (const u of items[i].ups) u(isc);
        else items.push(mountBlock(content, isc, end, inst));
      });
      while (items.length > list.length) unmountBlock(items.pop());
    });
  }

  function buildImport(n, out, parent) {
    const name = n.getAttribute('name');
    const host = document.createElement('div');
    host.style.display = 'contents';
    host.setAttribute('data-dc-import', name);
    out.appendChild(host);
    const def = DEFS[name];
    if (!def) return;
    const attrs = {};
    for (const a of Array.from(n.attributes)) {
      if (a.name === 'name' || a.name.indexOf('hint-') === 0) continue;
      attrs[a.name] = a.value;
    }
    parent.children.push(createInstance(def, attrs, host));
  }

  function createInstance(def, attrs, host) {
    addHelmet(def);
    const props = Object.assign({}, def.propDefaults, attrs);
    const logic = new def.Comp(props);
    logic.props = props;
    const inst = { logic: logic, ups: [], children: [], mounted: false, pending: false, cbs: [] };
    logic.__inst = inst;

    const frag = document.createDocumentFragment();
    buildChildren(def.tpl.content, frag, inst.ups, inst);

    inst.render = function () {
      const vals = logic.renderVals() || {};
      for (const u of inst.ups) u(vals);
    };
    inst.schedule = function (cb) {
      if (cb) inst.cbs.push(cb);
      if (inst.pending) return;
      inst.pending = true;
      const prevState = logic.state;
      Promise.resolve().then(function () {
        inst.pending = false;
        inst.render();
        if (logic.componentDidUpdate) logic.componentDidUpdate(logic.props, prevState);
        const cbs = inst.cbs;
        inst.cbs = [];
        cbs.forEach(function (f) { f(); });
      });
    };

    inst.render();
    host.appendChild(frag);
    return inst;
  }

  function didMountTree(inst) {
    inst.children.forEach(didMountTree);
    inst.mounted = true;
    if (inst.logic.componentDidMount) inst.logic.componentDidMount();
  }

  function willUnmountTree(inst) {
    if (inst.logic.componentWillUnmount) inst.logic.componentWillUnmount();
    inst.children.forEach(willUnmountTree);
  }

  async function boot() {
    const srcEl = document.getElementById('__dc_src');
    const text = srcEl ? srcEl.textContent : '';
    if (srcEl) srcEl.remove();
    const def = parseSource(text);
    await loadImports(def);
    const root = createInstance(def, {}, document.body);
    didMountTree(root);
    window.addEventListener('pagehide', function () { willUnmountTree(root); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    boot().catch(function (e) { console.error('[dc] render failed', e); });
  });
})();
