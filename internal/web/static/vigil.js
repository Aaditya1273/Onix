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

  // Column headings for a min-cut network, in the order the data flows.
  const ROLE = { source: 'Untrusted origin', read: 'Earlier reads', value: 'Values they carried', arg: 'Arguments of this call', call: 'This call', sink: 'Leaves the machine' };

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
    // The nodes are reachable by keyboard and read out, so the drawing must not be a flat image to assistive tech.
    if (svg.getAttribute('role') === 'img') svg.setAttribute('role', 'group');
    if (!g.nodes.length) return Promise.resolve();
    const { layer, cols } = layout(g);
    const ncol = Object.keys(cols).length;
    const maxRows = Math.max(...Object.values(cols).map(c => c.length));
    // Columns mean something: when the nodes say what they are (a min-cut network does),
    // each column gets a heading and the reader sees the order of events, not a tangle.
    const head = g.nodes.some(n => n.role) ? 40 : 0;
    const W = Math.max(640, ncol * 240), H = Math.max(150, maxRows * 80 + 30) + head;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.style.maxWidth = W + 'px'; // never drawn larger than life: a small graph stays small
    // It always fits its frame (no sideways scrollbar); zoom and full screen give detail.
    const pos = {};
    Object.entries(cols).forEach(([c, list]) => {
      list.forEach((id, i) => {
        pos[id] = { x: 100 + (+c) * ((W - 200) / Math.max(1, ncol - 1)), y: head + ((H - head) / (list.length + 1)) * (i + 1) };
      });
    });
    if (ncol === 1) Object.values(pos).forEach(p => (p.x = W / 2));
    if (head) {
      const byId = Object.fromEntries(g.nodes.map(n => [n.id, n]));
      Object.entries(cols).forEach(([c, list]) => {
        const roles = [...new Set(list.map(id => byId[id].role).filter(Boolean))];
        if (roles.length !== 1 || !ROLE[roles[0]]) return;
        const t = el('text', { x: pos[list[0]].x, y: 22, class: 'colhead' }, svg);
        t.textContent = ROLE[roles[0]];
      });
    }
    const defs = el('defs', {}, svg);
    ['grey', 'cut', 'verdict'].forEach(k => {
      const m = el('marker', { id: 'arr-' + k, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
      el('path', { d: 'M0,0 L10,5 L0,10 z', class: 'arrow-' + k }, m);
    });
    let edgeRoles = null;
    const order = g.edges.slice().sort((a, b) => layer[a.from] - layer[b.from]);
    const labelled = new Set(); // edges fanning into one node with one label are labelled once
    const room = Math.max(8, Math.floor(((W - 200) / Math.max(1, ncol - 1) - 168 + 60) / 6.6)); // characters that fit between two columns
    const edgeEls = order.map(e => {
      const a = pos[e.from], b = pos[e.to];
      if (!a || !b) return null;
      const k = e.cut ? 'cut' : e.verdict ? 'verdict' : 'grey';
      const byIdE = edgeRoles || (edgeRoles = Object.fromEntries(g.nodes.map(n => [n.id, n.role || ''])));
      const grp = el('g', { class: 'edge hidden ' + k, 'data-from-role': byIdE[e.from], 'data-to-role': byIdE[e.to] }, svg);
      const mx = (a.x + b.x) / 2;
      const d = `M${a.x + 84},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x - 86},${b.y}`;
      const p = el('path', { d, class: 'line', 'marker-end': `url(#arr-${k})` }, grp);
      el('path', { d, class: 'hit' }, grp); // a wide invisible stroke, so the edge is easy to hover
      if (e.label && !labelled.has(e.to + '|' + e.label)) {
        labelled.add(e.to + '|' + e.label);
        const t = el('text', { x: mx, y: (a.y + b.y) / 2 - 12, class: 'elabel' }, grp);
        t.textContent = clip((e.cut ? '✂ ' : '') + e.label, room); // the full label is in the tooltip
      }
      return { e, grp, p };
    });
    const nodeEls = {};
    g.nodes.forEach(n => {
      const p = pos[n.id];
      const grp = el('g', { class: 'node hidden ' + (n.kind || ''), transform: `translate(${p.x},${p.y})`, tabindex: 0, role: 'img', 'aria-label': describeNode(g, n), 'data-id': n.id, 'data-role': n.role || '' }, svg);
      el('rect', { x: -84, y: -24, width: 168, height: 48, rx: 8 }, grp);
      const t = el('text', { y: n.sub ? -4 : 5, class: 'nlabel' }, grp);
      t.textContent = clip(n.label, 21);
      if (n.sub) {
        const s = el('text', { y: 13, class: 'nsub' }, grp);
        s.textContent = clip(n.sub, 26);
      }
      nodeEls[n.id] = grp;
    });
    edgeEls.forEach(x => x && svg.appendChild(x.grp)); // edges and their labels above the boxes, so a label is never hidden
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
    // The tip is fixed to the viewport, so a scrolling or clipped frame never cuts it off.
    const place = (ev, html) => {
      tip.innerHTML = html; tip.classList.add('on');
      const half = Math.min(170, innerWidth / 2 - 8);
      tip.style.left = Math.min(Math.max(ev.clientX, half + 8), innerWidth - half - 8) + 'px';
      tip.style.top = ev.clientY + 'px';
      tip.classList.toggle('below', ev.clientY < 110); // near the top of the window, show it under the pointer
    };
    Object.entries(nodeEls).forEach(([id, node]) => {
      const n = byId[id];
      node.addEventListener('mouseenter', () => {
        const es = edges.filter(x => x.e.from === id || x.e.to === id);
        light([id, ...es.map(x => x.e.from), ...es.map(x => x.e.to)], es);
      });
      node.addEventListener('mousemove', ev => place(ev, `<b>${esc(n.label)}</b>${n.sub ? '<br>' + esc(n.sub) : ''}`));
      node.addEventListener('mouseleave', clear);
      // Keyboard: focusing a node does what hovering does, with the tip above the box.
      node.addEventListener('focus', () => {
        const es = edges.filter(x => x.e.from === id || x.e.to === id);
        light([id, ...es.map(x => x.e.from), ...es.map(x => x.e.to)], es);
        const r = node.getBoundingClientRect();
        place({ clientX: r.left + r.width / 2, clientY: r.top }, `<b>${esc(n.label)}</b>${n.sub ? '<br>' + esc(n.sub) : ''}`);
      });
      node.addEventListener('blur', clear);
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
  // Listeners are attached once per svg; calling it again (after the next dag()
  // redraw) only re-reads the drawing's size, so redraws never stack handlers.
  function zoomable(svg) {
    const vb = svg.viewBox.baseVal, base = { x: 0, y: 0, w: vb.width, h: vb.height };
    if (svg._vz) { svg._vz.reset(base); return svg._vz.api; }
    const st = { base, v: { ...base }, drag: null };
    const set = () => { const v = st.v; svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`); svg.classList.toggle('zoomed', v.w < st.base.w - 0.5); };
    // Panning may run half a frame past the drawing, as in a map; never further.
    const keep = () => { const v = st.v, b = st.base; v.x = Math.min(Math.max(v.x, -b.w / 2), b.w - v.w / 2); v.y = Math.min(Math.max(v.y, -b.h / 2), b.h - v.h / 2); };
    const zoom = (f, cx, cy) => {
      const v = st.v, b = st.base;
      cx = cx ?? v.x + v.w / 2; cy = cy ?? v.y + v.h / 2;
      const w = Math.min(b.w, Math.max(b.w / 6, v.w * f)), h = w * b.h / b.w;
      st.v = { x: cx - (cx - v.x) * (w / v.w), y: cy - (cy - v.y) * (h / v.h), w, h }; keep(); set();
    };
    const at = ev => { const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
    svg.addEventListener('wheel', ev => { if (!ev.ctrlKey && !ev.metaKey) return; ev.preventDefault(); const p = at(ev); zoom(ev.deltaY > 0 ? 1.15 : 1 / 1.15, p.x, p.y); }, { passive: false });
    svg.addEventListener('dblclick', ev => { const p = at(ev); zoom(1 / 1.6, p.x, p.y); });
    svg.addEventListener('pointerdown', ev => { if (ev.button !== 0 || ev.target.closest('.node')) return; st.drag = { x: ev.clientX, y: ev.clientY, v: { ...st.v } }; svg.setPointerCapture(ev.pointerId); svg.classList.add('dragging'); });
    svg.addEventListener('pointermove', ev => { const d = st.drag; if (!d) return; const s = st.v.w / svg.clientWidth; st.v.x = d.v.x - (ev.clientX - d.x) * s; st.v.y = d.v.y - (ev.clientY - d.y) * s; keep(); set(); });
    const up = () => { st.drag = null; svg.classList.remove('dragging'); };
    svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
    const api = {
      in: () => zoom(1 / 1.35), out: () => zoom(1.35), fit: () => { st.v = { ...st.base }; set(); },
      pan: (fx, fy) => { st.v.x += fx * st.v.w; st.v.y += fy * st.v.h; keep(); set(); },
    };
    svg._vz = { api, reset: b => { st.base = b; st.v = { ...b }; st.drag = null; svg.classList.remove('zoomed', 'dragging'); } };
    return api;
  }

  const ICON = {
    expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    up: '<path d="m18 15-6-6-6 6"/>', down: '<path d="m6 9 6 6 6-6"/>',
    left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    zin: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M11 8v6M8 11h6"/>',
    zout: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6"/>',
  };
  const icon = k => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.vg-full').forEach(h => h.querySelector('.vg-expand')?.click());
  });

  // The graph frame's controls: one toolbar in a strip below the drawing, so it
  // never covers a node. Safe to call after every dag(): the toolbar is rebuilt
  // and the zoom listeners are not duplicated.
  function controls(svg) {
    const host = svg.parentElement;
    host.classList.add('vg-frame');
    host.querySelectorAll(':scope > .vg-ctl').forEach(x => x.remove());
    const z = zoomable(svg);
    const btn = (k, title, fn, cls) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'vg-btn ' + (cls || ''); b.innerHTML = icon(k); b.title = title; b.setAttribute('aria-label', title);
      b.onclick = fn;
      return b;
    };
    const full = () => host.classList.contains('vg-full');
    const expand = btn(full() ? 'close' : 'expand', full() ? 'Close full screen' : 'Full screen', () => {
      const on = !full();
      host.classList.toggle('vg-full', on);
      document.documentElement.classList.toggle('vg-lock', on);
      expand.innerHTML = icon(on ? 'close' : 'expand');
      expand.title = on ? 'Close full screen' : 'Full screen'; expand.setAttribute('aria-label', expand.title);
      expand.setAttribute('aria-pressed', String(on));
      z.fit();
      if (on) expand.focus();
    }, 'vg-expand');
    expand.setAttribute('aria-pressed', String(full()));
    const bar = document.createElement('div'); bar.className = 'vg-ctl vg-bar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Graph view');
    const sep = document.createElement('span'); sep.className = 'vg-sep'; sep.setAttribute('aria-hidden', 'true');
    bar.append(
      btn('zout', 'Zoom out', z.out), btn('zin', 'Zoom in', z.in), btn('reset', 'Reset view', z.fit),
      btn('left', 'Pan left', () => z.pan(-0.2, 0)), btn('up', 'Pan up', () => z.pan(0, -0.2)),
      btn('down', 'Pan down', () => z.pan(0, 0.2)), btn('right', 'Pan right', () => z.pan(0.2, 0)),
      sep, expand,
    );
    host.append(bar);
    // A graph wider than its frame scrolls sideways; bring the decision into view rather than leave it off the edge.
    const v = svg.querySelector('.node.verdict');
    if (v && host.scrollWidth > host.clientWidth + 1) {
      const hr = host.getBoundingClientRect(), r = v.getBoundingClientRect();
      if (r.right > hr.right) host.scrollLeft += r.right - hr.right + 24;
    }
    return z;
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
    // What each node is, from the kind of edge that reaches it (cut_build.cypher's FLOW kinds).
    const INTO = { source: 'read', read: 'value', taints: 'arg', arg: 'call', terminal: 'sink' };
    Object.values(nodes).forEach(n => (n.role = 'source'));
    edges.forEach(e => { if (INTO[e.kind]) nodes[e.to].role = INTO[e.kind]; });
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
  // Throws an Error with .status and .kind (network | sleeping | rate_limited |
  // unavailable | http | parse), so a page can say what actually happened.
  async function getJSON(url, init) {
    const fail = (kind, msg, status) => Object.assign(new Error(msg), { kind, status: status || 0 });
    let r;
    try { r = await fetch(url, Object.assign({ cache: 'no-store' }, init || {})); }
    catch (_) { throw fail('network', 'The server could not be reached.'); }
    const text = await r.text();
    let body; try { body = text ? JSON.parse(text) : {}; } catch (_) { body = undefined; }
    if (!r.ok) {
      const kind = r.status === 429 ? 'rate_limited' : [502, 503, 504].includes(r.status) && body === undefined ? 'sleeping' : r.status === 503 ? 'unavailable' : 'http';
      throw fail(kind, (body && body.error) || ('HTTP ' + r.status), r.status);
    }
    if (body === undefined) throw fail('parse', 'The server sent a response this page could not read.', r.status);
    return body;
  }
  function copy(text, btn) {
    const done = () => { if (btn) { const t = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => (btn.textContent = t), 1400); } };
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(done, () => {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (_) {} ta.remove();
    });
  }

  // One sentence per node for screen readers: what it is and what it connects to.
  function describeNode(g, n) {
    const lbl = id => (g.nodes.find(x => x.id === id) || { label: id }).label;
    const out = g.edges.filter(e => e.from === n.id).map(e => `${e.cut ? 'cut edge ' : ''}${e.label || 'to'} ${lbl(e.to)}`);
    const inn = g.edges.filter(e => e.to === n.id).map(e => `${e.cut ? 'cut edge ' : ''}${e.label || 'from'} from ${lbl(e.from)}`);
    return [n.label, n.sub, n.kind === 'verdict' ? 'the decision' : '', inn.length ? 'in: ' + inn.join('; ') : '', out.length ? 'out: ' + out.join('; ') : ''].filter(Boolean).join('. ');
  }

  // A graph as a list of its relationships, in a <details> after the drawing:
  // the same facts without hover, zoom or sight. Replaces any earlier one.
  function alt(svg, g, title) {
    const host = svg.closest('.vg-box, .graph') || svg.parentElement;
    let d = host.nextElementSibling && host.nextElementSibling.classList.contains('vg-alt') ? host.nextElementSibling : null;
    if (!g.edges.length && !g.nodes.length) { if (d) d.remove(); return; }
    if (!d) { d = document.createElement('details'); d.className = 'vg-alt'; host.after(d); }
    const lbl = id => esc((g.nodes.find(x => x.id === id) || { label: id }).label);
    const rows = g.edges.length
      ? g.edges.map(e => `<li>${lbl(e.from)} → ${lbl(e.to)}${e.label ? ` <span class="mono">(${esc(e.label)})</span>` : ''}${e.cut ? ' <span class="cut">✂ the min cut severs this edge</span>' : ''}</li>`).join('')
      : g.nodes.map(n => `<li>${esc(n.label)}${n.sub ? ' · ' + esc(n.sub) : ''}</li>`).join('');
    const open = d.open;
    d.innerHTML = `<summary>${esc(title || 'The graph as a list')} (${g.edges.length || g.nodes.length})</summary><ol>${rows}</ol>`;
    d.open = open;
  }

  // The backend's verdicts, mapped as the dashboard maps them (lib/verdict.ts).
  const VERDICT = {
    allowed: ['Allowed', '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>'],
    rewritten: ['Rewritten', '<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>'],
    paused: ['Paused', '<circle cx="12" cy="12" r="10"/><path d="M10 15V9M14 15V9"/>'],
    blocked: ['Blocked', '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>'],
    critical: ['Critical', '<path d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86z"/><path d="M12 8v4M12 16h.01"/>'],
  };
  function verdict(decision, stage, unsafe) {
    if (unsafe) return 'critical'; // the attack reached an unsafe effect
    const d = String(decision || '').toUpperCase();
    if (d === 'BLOCK' || d === 'DENY') return 'blocked';
    if (d === 'PAUSE' || d === 'ASK') return 'paused';
    if (stage === 'redact' || d === 'REWRITE' || d === 'REDACT') return 'rewritten';
    return 'allowed';
  }
  const label = v => (VERDICT[v] || VERDICT.allowed)[0];
  function badge(v, opts) {
    opts = opts || {};
    const [word, path] = VERDICT[v] || VERDICT.allowed;
    return `<span class="v-badge v-${VERDICT[v] ? v : 'allowed'}${opts.solid ? ' v-solid' : ''}${opts.large ? ' v-lg' : ''}"${opts.title ? ` title="${esc(opts.title)}"` : ''}>` +
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>${word}</span>`;
  }

  // What a failed getJSON means, in words a visitor can act on.
  function explain(err) {
    const k = err && err.kind;
    if (k === 'network' || k === 'sleeping') return 'The server is not answering yet. Free hosting sleeps when idle and takes up to a minute to wake.';
    if (k === 'rate_limited') return 'Too many attempts from your address. Wait a minute and try again.';
    if (k === 'unavailable') return 'The server is up, but its graph database is not reachable right now.';
    if (err && err.status === 404) return 'This server does not offer this (the playground and the time-travel pages run on different server modes).';
    return (err && err.message) || 'Something went wrong.';
  }
  // An honest state panel in el: kind is loading | empty | sleeping | error.
  // retry (optional) adds a working "Try again" button.
  function state(el, kind, title, body, retry) {
    el.innerHTML = `<div class="vg-state ${kind}" role="${kind === 'error' || kind === 'sleeping' ? 'alert' : 'status'}"${kind === 'loading' ? ' aria-busy="true"' : ''}>` +
      `<b>${esc(title)}</b>${body ? `<span>${esc(body)}</span>` : ''}${retry ? '<button type="button" class="vg-retry">Try again</button>' : ''}</div>`;
    if (retry) el.querySelector('.vg-retry').onclick = retry;
  }
  const kindOf = err => err && (err.kind === 'network' || err.kind === 'sleeping') ? 'sleeping' : 'error';

  window.VG = { ROLE, dag, zoomable, controls, focus, fromNetwork, fromPaths, num, when, day, esc, getJSON, copy, clip, alt, verdict, label, badge, explain, state, kindOf };
})();
