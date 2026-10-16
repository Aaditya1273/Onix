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
    const W = Math.max(640, ncol * 260), H = Math.max(160, maxRows * 86 + 30);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const pos = {};
    Object.entries(cols).forEach(([c, list]) => {
      list.forEach((id, i) => {
        pos[id] = { x: 90 + (+c) * ((W - 180) / Math.max(1, ncol - 1)), y: (H / (list.length + 1)) * (i + 1) };
      });
    });
    if (ncol === 1) Object.values(pos).forEach(p => (p.x = W / 2));
    const defs = el('defs', {}, svg);
    ['grey', 'cut', 'verdict'].forEach(k => {
      const m = el('marker', { id: 'arr-' + k, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
      el('path', { d: 'M0,0 L10,5 L0,10 z', class: 'arrow-' + k }, m);
    });
    const order = g.edges.slice().sort((a, b) => layer[a.from] - layer[b.from]);
    const edgeEls = order.map(e => {
      const a = pos[e.from], b = pos[e.to];
      if (!a || !b) return null;
      const k = e.cut ? 'cut' : e.verdict ? 'verdict' : 'grey';
      const grp = el('g', { class: 'edge hidden ' + k }, svg);
      const mx = (a.x + b.x) / 2;
      const p = el('path', { d: `M${a.x + 70},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x - 72},${b.y}`, 'marker-end': `url(#arr-${k})` }, grp);
      if (e.label) {
        const t = el('text', { x: mx, y: (a.y + b.y) / 2 - 12, class: 'elabel' }, grp);
        t.textContent = (e.cut ? '✂ ' : '') + e.label;
      }
      return { e, grp, p };
    });
    const nodeEls = {};
    g.nodes.forEach(n => {
      const p = pos[n.id];
      const grp = el('g', { class: 'node hidden ' + (n.kind || ''), transform: `translate(${p.x},${p.y})` }, svg);
      el('rect', { x: -70, y: -24, width: 140, height: 48, rx: 10 }, grp);
      const t = el('text', { y: n.sub ? -4 : 5, class: 'nlabel' }, grp);
      t.textContent = clip(n.label, 22);
      el('title', {}, grp).textContent = n.label + (n.sub ? '\n' + n.sub : '');
      if (n.sub) {
        const s = el('text', { y: 13, class: 'nsub' }, grp);
        s.textContent = clip(n.sub, 26);
      }
      nodeEls[n.id] = grp;
    });
    const show = x => x && x.classList.remove('hidden');
    if (!opts.animate) {
      Object.values(nodeEls).forEach(show);
      edgeEls.forEach(x => x && show(x.grp));
      return Promise.resolve();
    }
    // Hop by hop: roots first, then each edge and the node it reaches.
    const step = opts.stepMs || 380;
    Object.entries(layer).filter(([, l]) => l === 0).forEach(([id]) => show(nodeEls[id]));
    return new Promise(res => {
      let i = 0;
      const tick = () => {
        if (i >= edgeEls.length) return res();
        const x = edgeEls[i++];
        if (x) { show(x.grp); show(nodeEls[x.e.to]); }
        setTimeout(tick, step);
      };
      setTimeout(tick, step);
    });
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

  window.VG = { dag, fromNetwork, fromPaths, num, when, day, esc, getJSON, copy, clip };
})();
