// Shared by the reveal, playground and time-travel pages: a small layered-DAG
// renderer in SVG (one question's subgraph, never the whole graph), animated
// hop by hop, plus formatting helpers. No dependencies.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };

  // Longest-path layering: a node sits one column right of its furthest parent.
  function layout(g) {
    const ids = g.nodes.map(n => n.id);
    const preds = Object.fromEntries(ids.map(i => [i, []]));
    g.edges.forEach(e => preds[e.to] && preds[e.to].push(e.from));
    const layer = {};
    const visit = (id, seen) => {
      if (layer[id] !== undefined) return layer[id];
      if (seen.has(id)) return 0; // a cycle: break it
      seen.add(id);
      const ps = preds[id] || [];
      layer[id] = ps.length ? Math.max(...ps.map(p => visit(p, seen))) + 1 : 0;
      return layer[id];
    };
    ids.forEach(i => visit(i, new Set()));
    // A root sits one column before its nearest child, so a late session does
    // not draw an edge across the whole graph.
    ids.filter(i => !(preds[i] || []).length).forEach(i => {
      const kids = g.edges.filter(e => e.from === i).map(e => layer[e.to]);
      if (kids.length) layer[i] = Math.max(0, Math.min(...kids) - 1);
    });
    const cols = {};
    ids.forEach(i => (cols[layer[i]] = cols[layer[i]] || []).push(i));
    return { layer, cols };
  }

  // g: {nodes:[{id,label,sub,kind}], edges:[{from,to,label,cut,verdict}]}
  // kind 'verdict' paints the node in the verdict colour; edge.cut in the cut colour.
  function dag(svg, g, opts) {
    opts = opts || {};
    svg.innerHTML = '';
    if (!g.nodes.length) return Promise.resolve();
    const { layer, cols } = layout(g);
    const ncol = Object.keys(cols).length;
    const maxRows = Math.max(...Object.values(cols).map(c => c.length));
    const W = Math.max(640, ncol * 240), H = Math.max(150, maxRows * 80 + 30);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.style.maxWidth = W + 'px'; // never drawn larger than life: a small graph stays small
    const pos = {};
    Object.entries(cols).forEach(([c, list]) => {
      list.forEach((id, i) => {
        pos[id] = { x: 100 + (+c) * ((W - 200) / Math.max(1, ncol - 1)), y: (H / (list.length + 1)) * (i + 1) };
      });
    });
    if (ncol === 1) Object.values(pos).forEach(p => (p.x = W / 2));
    const defs = el('defs', {}, svg);
    ['grey', 'cut', 'verdict'].forEach(k => {
      const m = el('marker', { id: 'arr-' + k, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
      el('path', { d: 'M0,0 L10,5 L0,10 z', class: 'arrow-' + k }, m);
    });
    const order = g.edges.slice().sort((a, b) => layer[a.from] - layer[b.from]);
    const labelled = new Set(); // edges fanning into one node with one label are labelled once
    const edgeEls = order.map(e => {
      const a = pos[e.from], b = pos[e.to];
      if (!a || !b) return null;
      const k = e.cut ? 'cut' : e.verdict ? 'verdict' : 'grey';
      const grp = el('g', { class: 'edge hidden ' + k }, svg);
      const mx = (a.x + b.x) / 2;
      const d = `M${a.x + 84},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x - 86},${b.y}`;
      const p = el('path', { d, class: 'line', 'marker-end': `url(#arr-${k})` }, grp);
      el('path', { d, class: 'hit' }, grp); // a wide invisible stroke, so the edge is easy to hover
      if (e.label && !labelled.has(e.to + '|' + e.label)) {
        labelled.add(e.to + '|' + e.label);
        const t = el('text', { x: mx, y: (a.y + b.y) / 2 - 12, class: 'elabel' }, grp);
        t.textContent = (e.cut ? '✂ ' : '') + e.label;
      }
      return { e, grp, p };
    });
    const nodeEls = {};
    g.nodes.forEach(n => {
      const p = pos[n.id];
      const grp = el('g', { class: 'node hidden ' + (n.kind || ''), transform: `translate(${p.x},${p.y})` }, svg);
      el('rect', { x: -84, y: -24, width: 168, height: 48, rx: 8 }, grp);
      const t = el('text', { y: n.sub ? -4 : 5, class: 'nlabel' }, grp);
      t.textContent = clip(n.label, 21);
      if (n.sub) {
        const s = el('text', { y: 13, class: 'nsub' }, grp);
        s.textContent = clip(n.sub, 26);
      }
      nodeEls[n.id] = grp;
    });
    hoverable(svg, g, nodeEls, edgeEls.filter(Boolean));
    const show = x => x && x.classList.remove('hidden');
    const done = () => { svg.classList.add('live'); }; // data flows along the edges once the path is drawn
    if (!opts.animate || reduced()) {
      Object.values(nodeEls).forEach(show);
      edgeEls.forEach(x => x && show(x.grp));
      done();
      return Promise.resolve();
    }
    // Hop by hop: roots first, then each edge and the node it reaches.
    const step = opts.stepMs || 380;
    const hasIn = new Set(g.edges.map(e => e.to));
    g.nodes.filter(n => !hasIn.has(n.id)).forEach(n => show(nodeEls[n.id])); // roots, wherever layout put them
    return new Promise(res => {
      let i = 0;
      const tick = () => {
        if (i >= edgeEls.length) { done(); return res(); }
        const x = edgeEls[i++];
        if (x) { show(x.grp); show(nodeEls[x.e.to]); }
        setTimeout(tick, step);
      };
      setTimeout(tick, step);
    });
  }

  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  // What a network edge means, for the tooltip.
  const EDGE = {
    source: 'where tainted data enters', read: 'this call read the value', taints: 'the value is inside this argument',
    arg: 'the argument feeds the call', terminal: 'the call itself', READ: 'read by', ARG_CONTAINS: 'the value is in this call\'s arguments',
    MADE: 'this session made the call', DECIDED: 'the decision on this call', PREV: 'the decision before it', TYPOSQUAT_OF: 'a look-alike of',
  };

  // Hovering a node or an edge lights it and its neighbours and dims the rest;
  // a tooltip shows the full label. focus(fn) does the same from outside.
  function hoverable(svg, g, nodeEls, edges) {
    const host = svg.parentElement;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    const tip = host.querySelector(':scope > .vg-tip') || host.appendChild(Object.assign(document.createElement('div'), { className: 'vg-tip', role: 'tooltip' }));
    const byId = Object.fromEntries(g.nodes.map(n => [n.id, n]));
    const clear = () => { svg.classList.remove('focus'); svg.querySelectorAll('.hl').forEach(x => x.classList.remove('hl')); tip.classList.remove('on'); };
    const light = (ids, es) => {
      clear(); svg.classList.add('focus');
      ids.forEach(id => nodeEls[id] && nodeEls[id].classList.add('hl'));
      es.forEach(x => x.grp.classList.add('hl'));
    };
    const place = (ev, html) => {
      const r = host.getBoundingClientRect();
      tip.innerHTML = html; tip.classList.add('on');
      tip.style.left = (ev.clientX - r.left + host.scrollLeft) + 'px';
      tip.style.top = (ev.clientY - r.top + host.scrollTop) + 'px';
      tip.classList.toggle('below', ev.clientY - r.top < 110); // near the top edge, show it under the pointer
    };
    Object.entries(nodeEls).forEach(([id, node]) => {
      const n = byId[id];
      node.addEventListener('mouseenter', () => {
        const es = edges.filter(x => x.e.from === id || x.e.to === id);
        light([id, ...es.map(x => x.e.from), ...es.map(x => x.e.to)], es);
      });
      node.addEventListener('mousemove', ev => place(ev, `<b>${esc(n.label)}</b>${n.sub ? '<br>' + esc(n.sub) : ''}`));
      node.addEventListener('mouseleave', clear);
    });
    edges.forEach(x => {
      x.grp.addEventListener('mouseenter', () => light([x.e.from, x.e.to], [x]));
      x.grp.addEventListener('mousemove', ev => {
        const kind = String(x.e.label || '').split(' ')[0];
        const cap = String(x.e.label || '').split(' ')[1];
        place(ev, `<b>${esc(byId[x.e.from]?.label || x.e.from)}</b> → <b>${esc(byId[x.e.to]?.label || x.e.to)}</b><br>${esc(EDGE[kind] || x.e.label || '')}` +
          (cap ? `<br>cost to cut: ${esc(cap)}` : '') + (x.e.cut ? '<br><span class="cut">The min cut severs this edge.</span>' : ''));
      });
      x.grp.addEventListener('mouseleave', clear);
    });
    svg._vg = { focus: fn => { const ids = g.nodes.filter(fn).map(n => n.id); if (!ids.length) return clear(); light(ids, edges.filter(x => ids.includes(x.e.from) && ids.includes(x.e.to))); tip.classList.remove('on'); }, clear };
  }
  const focus = (svg, fn) => svg && svg._vg && (fn ? svg._vg.focus(fn) : svg._vg.clear());

  // Zoom and pan by rewriting the viewBox: buttons, Ctrl or Cmd + wheel at the
  // pointer, drag to pan, double-click to zoom in. Returns {in, out, fit}.
  function zoomable(svg) {
    const vb = svg.viewBox.baseVal, base = { x: 0, y: 0, w: vb.width, h: vb.height };
    let v = { ...base };
    const set = () => { svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`); svg.classList.toggle('zoomed', v.w < base.w - 0.5); };
    const keep = () => { v.x = Math.min(Math.max(v.x, 0), base.w - v.w); v.y = Math.min(Math.max(v.y, 0), base.h - v.h); };
    const zoom = (f, cx, cy) => {
      cx = cx ?? v.x + v.w / 2; cy = cy ?? v.y + v.h / 2;
      const w = Math.min(base.w, Math.max(base.w / 6, v.w * f)), h = w * base.h / base.w;
      v = { x: cx - (cx - v.x) * (w / v.w), y: cy - (cy - v.y) * (h / v.h), w, h }; keep(); set();
    };
    const at = ev => { const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
    svg.addEventListener('wheel', ev => { if (!ev.ctrlKey && !ev.metaKey) return; ev.preventDefault(); const p = at(ev); zoom(ev.deltaY > 0 ? 1.15 : 1 / 1.15, p.x, p.y); }, { passive: false });
    svg.addEventListener('dblclick', ev => { const p = at(ev); zoom(1 / 1.6, p.x, p.y); });
    let drag = null;
    svg.addEventListener('pointerdown', ev => { if (v.w >= base.w - 0.5) return; drag = { x: ev.clientX, y: ev.clientY, v: { ...v } }; svg.setPointerCapture(ev.pointerId); svg.classList.add('dragging'); });
    svg.addEventListener('pointermove', ev => { if (!drag) return; const s = v.w / svg.clientWidth; v.x = drag.v.x - (ev.clientX - drag.x) * s; v.y = drag.v.y - (ev.clientY - drag.y) * s; keep(); set(); });
    const up = () => { drag = null; svg.classList.remove('dragging'); };
    svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
    return { in: () => zoom(1 / 1.35), out: () => zoom(1.35), fit: () => { v = { ...base }; set(); } };
  }

  function clip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  // A min-cut influence network (FlowEdge rows) as a DAG.
  function fromNetwork(edges) {
    const nodes = {};
    const add = name => (nodes[name] = nodes[name] || { id: name, label: name.replace(/^arg: /, 'arg ').replace(/^effect: /, '') });
    const out = edges.map(e => {
      add(e.from); add(e.to);
      const cap = e.cap >= 1e6 ? '∞' : e.cap;
      return { from: e.from, to: e.to, label: e.kind + ' ' + cap, cut: e.cut };
    });
    if (nodes.sink) nodes.sink.kind = 'verdict';
    return { nodes: Object.values(nodes), edges: out };
  }

  // Stored decision paths: "a --[REL]--> b --[REL2]--> c".
  function fromPaths(paths) {
    const nodes = {}, edges = [];
    (paths || []).forEach(p => {
      const parts = p.split(/ --\[(.+?)\]--> /);
      for (let i = 0; i + 2 < parts.length; i += 2) {
        const a = parts[i], rel = parts[i + 1], b = parts[i + 2];
        nodes[a] = nodes[a] || { id: a, label: a };
        nodes[b] = nodes[b] || { id: b, label: b };
        edges.push({ from: a, to: b, label: rel });
      }
    });
    return { nodes: Object.values(nodes), edges };
  }

  const num = n => Number(n || 0).toLocaleString('en-US');
  const when = ns => ns ? new Date(ns / 1e6).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '';
  const day = ns => ns ? new Date(ns / 1e6).toISOString().slice(0, 10) : '';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  async function getJSON(url, init) {
    const r = await fetch(url, Object.assign({ cache: 'no-store' }, init || {}));
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || ('HTTP ' + r.status));
    return body;
  }
  function copy(text, btn) {
    const done = () => { if (btn) { const t = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => (btn.textContent = t), 1400); } };
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(done, () => {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (_) {} ta.remove();
    });
  }

  window.VG = { dag, zoomable, focus, fromNetwork, fromPaths, num, when, day, esc, getJSON, copy, clip };
})();
