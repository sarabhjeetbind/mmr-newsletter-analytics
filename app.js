/* ============================================================
   MMR Newsletter Analytics — OpenBI App · 20 views, full functionality
   + cross-filtering (click a chart element or table row to filter the page)
   ============================================================ */
(function () {
  const C = window.OpenBICharts;
  const D = window.MMR;
  const N = D.months.length;
  const LAST = N - 1;

  const state = {
    view: 'home', currency: 'CAD', period: 'YTD', theme: 'light',
    entities: new Set(D.entities.map(e => e.key)),
    cadlc: 'CAD', topN: 10, asOf: LAST, fteParam: 172, hoursParam: 320,
    hoursExpanded: new Set(),
    xf: null,   // cross-filter: { field:'entity'|'client'|'bucket'|'person'|'project', value }
    mode: 'highlight',   // 'highlight' (dim non-selected) | 'filter' (remove non-selected)
  };
  const handles = {}, boundXF = new Set();

  /* ---------- formatting ---------- */
  const ccy = () => D.currencies[state.currency];
  function moneyIn(m, code) { const c = D.currencies[code] || ccy(); const v = m * c.factor; const a = Math.abs(v);
    return c.symbol + (a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2)) + 'M'; }
  const money = (m) => moneyIn(m, state.currency);
  function moneyK(k) { const c = ccy(); const v = k * c.factor; const a = Math.abs(v);
    if (a >= 1000) return c.symbol + (v / 1000).toFixed(2) + 'M';
    return c.symbol + Math.round(v).toLocaleString('en-US') + 'K'; }
  const conv = (arr) => arr.map(v => v * ccy().factor);
  const mFmt = (v) => { const a = Math.abs(v); return ccy().symbol + (a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2)) + 'M'; };
  const hFmt = (v) => Math.round(v).toLocaleString('en-US');
  const pFmt = (v) => v.toFixed(0) + '%';
  const pct = (x) => (x * 100).toFixed(1) + '%';
  const num = (v, d) => v.toLocaleString('en-US', { maximumFractionDigits: d == null ? 1 : d });
  function deltaHtml(cur, prev) { const d = prev ? (cur - prev) / Math.abs(prev) : 0;
    const cls = d > 0.0005 ? 'delta-up' : d < -0.0005 ? 'delta-down' : 'delta-flat';
    const arr = d > 0.0005 ? '↑' : d < -0.0005 ? '↓' : '→';
    return `<span class="t-delta ${cls}">${arr} ${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)}%</span>`; }
  function dataColor(slot) { const v = getComputedStyle(document.documentElement).getPropertyValue('--data-' + slot).trim(); return v || '#006F7B'; }
  const EMBER = () => getComputedStyle(document.documentElement).getPropertyValue('--ember-500').trim();

  /* ---------- entity + cross-filter ---------- */
  // xf narrows data only in FILTER mode; in HIGHLIGHT mode data stays full and marks are dimmed post-render
  const filtering = () => state.mode === 'filter' && !!state.xf;
  function effEntitySet() { return (filtering() && state.xf.field === 'entity') ? new Set([state.xf.value]) : state.entities; }
  const actEnt = () => D.entities.filter(e => effEntitySet().has(e.key));
  const inEnt = (x) => effEntitySet().has(x.entity);
  const allEnt = () => effEntitySet().size === D.entities.length;
  const xfClient = () => filtering() && state.xf.field === 'client' ? state.xf.value : null;
  const xfBucket = () => filtering() && state.xf.field === 'bucket' ? state.xf.value : null;
  const xfPerson = () => filtering() && state.xf.field === 'person' ? state.xf.value : null;
  const xfProject = () => filtering() && state.xf.field === 'project' ? state.xf.value : null;

  function setXF(field, value) {
    if (state.xf && state.xf.field === field && state.xf.value === value) state.xf = null;
    else state.xf = { field, value };
    renderCurrent();
  }
  function clearXF() { state.xf = null; renderCurrent(); }
  function xfResolve(name) { const e = D.entities.find(x => x.name === name || x.name.replace('MMR ', '') === name); return e ? e.key : name; }
  function bindChartXF(id, field, kind) {
    const el = document.getElementById(id); if (!el || boundXF.has(id)) return; boundXF.add(id); el.style.cursor = 'pointer';
    el.addEventListener('click', (e) => {
      const node = e.target.closest(kind === 'donut' ? 'path' : 'rect'); if (!node) return;
      const t = node.querySelector('title'); if (!t) return; const txt = t.textContent || '';
      let cat = kind === 'donut' ? txt.slice(0, txt.lastIndexOf(':')).trim() : (txt.split(' · ')[0] || '').trim();
      if (!cat || cat === 'Other') return;
      setXF(field, field === 'entity' ? xfResolve(cat) : cat);
    });
  }
  function wireXFRows(id, field) {
    const tbl = document.getElementById(id); if (!tbl) return;
    tbl.querySelectorAll('tbody tr[data-xf]').forEach(tr => {
      const v = tr.getAttribute('data-xf');
      if (state.xf && state.xf.field === field && state.xf.value === v) tr.classList.add('selected');
      tr.onclick = () => setXF(field, v);
    });
  }
  function xfDisplay() { if (!state.xf) return null; const { field, value } = state.xf;
    const m = { entity: 'Entity', client: 'Client', bucket: 'Aging bucket', person: 'Consultant', project: 'Project' };
    let v = value; if (field === 'entity') { const e = D.entityByKey[value]; v = e ? e.name : value; } return { label: m[field] || field, value: v }; }
  function renderChip() { const chip = document.getElementById('xfchip'); if (!chip) return; const d = xfDisplay();
    chip.innerHTML = d ? `<span class="xfchip">Cross-filter · ${d.label} = <span class="lbl2">${d.value}</span> <button id="xfClear" title="Clear cross-filter" aria-label="Clear">✕</button></span>` : '';
    if (d) document.getElementById('xfClear').onclick = clearXF; }

  /* ---------- derived ---------- */
  function globalRev() { const es = actEnt(); return D.months.map((_, i) => es.reduce((s, e) => s + e.rev[i], 0)); }
  function globalPY() { const es = actEnt(); return D.months.map((_, i) => es.reduce((s, e) => s + e.rev[i] * e.pyF, 0)); }
  function periodValue(arr) { if (state.period === 'MTD') return arr[LAST];
    if (state.period === 'QTD') return arr.slice(N - 3).reduce((a, b) => a + b, 0);
    return arr.slice(D.fiscalStartIndex).reduce((a, b) => a + b, 0); }
  const durationHrs = () => D.fte.map(f => f * D.HOURS_PER_FTE);
  const fteAdj = (i) => durationHrs()[i] / state.fteParam;
  const billableHrs = () => D.fte.map((f, i) => f * D.HOURS_PER_FTE * D.billability[i]);
  const nonBillableHrs = () => D.fte.map((f, i) => f * D.HOURS_PER_FTE * (1 - D.billability[i]));

  /* ---------- draw / kpi ---------- */
  function draw(id, fn) { const el = document.getElementById(id); if (!el) return;
    if (handles[id] && handles[id].destroy) { try { handles[id].destroy(); } catch (e) {} }
    el.innerHTML = ''; try { handles[id] = fn(el); } catch (e) { el.textContent = 'Chart error: ' + e.message; } }
  function kpiCard(o) { return `<div class="kpi ${o.highlight ? 'is-highlight' : ''}">
      <div class="kpi-label" ${o.highlight ? 'style="color:var(--ember-700);"' : ''}>${o.label}</div>
      <div class="kpi-value">${o.value}</div><div class="kpi-basis">${o.basis || ''}</div>
      <div class="kpi-spark" id="${o.sparkId}"></div></div>`; }
  function setKpis(containerId, cards) { document.getElementById(containerId).innerHTML = cards.map(kpiCard).join('');
    cards.forEach(o => { if (!o.sparkVals || !o.sparkVals.length) return;
      draw(o.sparkId, el => o.sparkColor ? C.sparkline(el, o.sparkVals, { color: o.sparkColor, height: 32 }) : C.sparkline(el, o.sparkVals, { slot: o.slot || 1, height: 32 })); }); }

  /* ---------- control builders ---------- */
  function segCtrl(id, label, options, active) { return `<span class="vlabel">${label}</span><div class="seg" id="${id}">` +
      options.map(o => `<button data-v="${o.v}" class="${o.v === active ? 'active' : ''}">${o.l}</button>`).join('') + `</div>`; }
  function wireSeg(id, cb) { const el = document.getElementById(id); if (!el) return; el.querySelectorAll('button').forEach(b => b.onclick = () => cb(b.dataset.v)); }
  function sliderCtrl(id, label, min, max, val, suffix) { return `<span class="slider"><span class="vlabel">${label}</span><input type="range" id="${id}" min="${min}" max="${max}" value="${val}"><b id="${id}-v">${val}${suffix || ''}</b></span>`; }
  function wireSlider(id, suffix, cb) { const el = document.getElementById(id); if (!el) return; el.oninput = () => { document.getElementById(id + '-v').textContent = el.value + (suffix || ''); cb(+el.value); }; }
  function asOfCtrl(id, val) { return `<span class="vlabel">As of</span><select class="sel" id="${id}">` + D.months.map((m, i) => `<option value="${i}" ${i === val ? 'selected' : ''}>${m}</option>`).join('') + `</select>`; }
  function setVB(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }
  const rebar = () => renderCurrent();

  /* ============================================================ RENDERERS */
  function renderHome() {
    const g = globalRev(), py = globalPY();
    const revP = periodValue(g), pyP = periodValue(py);
    setKpis('kpi-home', [
      { label: `Revenue · ${state.period}`, value: money(revP), basis: `${deltaHtml(revP, pyP)} · vs. PY ${money(pyP)}`, highlight: true, sparkId: 'sp-h1', sparkVals: g, sparkColor: EMBER() },
      { label: 'Avg FTE', value: Math.round(D.fte[LAST]), basis: `${deltaHtml(D.fte[LAST], D.fte[0])} · vs. 12m ago`, sparkId: 'sp-h2', sparkVals: D.fte, slot: 1 },
      { label: 'Billability', value: pct(D.billability[LAST]), basis: `${deltaHtml(D.billability[LAST], D.billability[LAST - 1])} · vs. prior month`, sparkId: 'sp-h3', sparkVals: D.billability.map(x => x * 100), slot: 2 },
      { label: 'Total AR', value: money(D.arTotal[LAST]), basis: `${pct(D.arOverdue[LAST] / D.arTotal[LAST])} overdue`, sparkId: 'sp-h4', sparkVals: D.arTotal, slot: 3 },
    ]);
    document.getElementById('home-refresh').textContent = 'Updated ' + D.refreshed;
    document.getElementById('home-mix-meta').textContent = 'Latest month · ' + D.months[LAST];
    draw('home-revtrend', el => C.line(el, { x: D.months, series: actEnt().map(e => ({ name: e.name, values: conv(e.rev) })) }, { yFormat: mFmt, legendPosition: 'top-right' }));
    draw('home-revmix', el => C.donut(el, actEnt().map(e => ({ label: e.name, value: e.rev[LAST] * ccy().factor })), { totalFormatter: mFmt, valueFormatter: mFmt }));
    bindChartXF('home-revmix', 'entity', 'donut');
    const total = g[LAST];
    const cont = document.getElementById('home-entities');
    cont.innerHTML = actEnt().map((e, i) => { const val = e.rev[LAST], share = total ? val / total : 0;
      const sel = state.xf && state.xf.field === 'entity' && state.xf.value === e.key ? ' selected' : '';
      return `<div class="caseitem${sel}" data-xf="${e.key}"><div><div class="nm">${e.name}</div><div class="sub">${e.ccy} · ${pct(share)} of global</div></div>
        <div class="bar"><i style="width:${(share * 100).toFixed(0)}%; background:${dataColor(i + 1)};"></i></div><div class="val">${money(val)}</div></div>`; }).join('');
    cont.querySelectorAll('[data-xf]').forEach(el => el.onclick = () => setXF('entity', el.getAttribute('data-xf')));
  }

  function renderRevenue() {
    setVB('vb-revenue', segCtrl('seg-rev', 'Currency basis', [{ v: 'CAD', l: 'CAD' }, { v: 'LC', l: 'Local (LC)' }], state.cadlc));
    wireSeg('seg-rev', v => { state.cadlc = v; rebar(); });
    const g = globalRev(), py = globalPY();
    const revP = periodValue(g), pyP = periodValue(py), yoy = pyP ? (revP - pyP) / pyP : 0;
    const top = actEnt().map(e => ({ e, v: periodValue(e.rev) })).sort((a, b) => b.v - a.v)[0];
    setKpis('kpi-rev', [
      { label: `Revenue · ${state.period}`, value: money(revP), basis: `${deltaHtml(revP, pyP)} · vs. PY ${money(pyP)}`, highlight: true, sparkId: 'sp-r1', sparkVals: g, sparkColor: EMBER() },
      { label: 'YoY growth', value: (yoy >= 0 ? '+' : '') + pct(yoy), basis: `${state.period} vs. prior year`, sparkId: 'sp-r2', sparkVals: g.map((v, i) => v - py[i]), slot: 1 },
      { label: 'Revenue / FTE', value: moneyK(g[LAST] * 1000 / fteAdj(LAST)), basis: `monthly · ${D.months[LAST]}`, sparkId: 'sp-r3', sparkVals: g.map((v, i) => v * 1000 / fteAdj(i)), slot: 2 },
      { label: 'Top entity', value: top ? top.e.name.replace('MMR ', '') : '—', basis: top ? `${money(top.v)}` : '', sparkId: 'sp-r4', sparkVals: top ? top.e.rev : [0], slot: 3 },
    ]);
    draw('rev-trend', el => C.line(el, { x: D.months, series: actEnt().map(e => ({ name: e.name, values: conv(e.rev) })) }, { yFormat: mFmt, legendPosition: 'top-right' }));
    draw('rev-actpy', el => C.line(el, { x: D.months.slice(N - 6), series: [{ name: 'Actual', values: conv(g.slice(N - 6)) }, { name: 'Prior year', values: conv(py.slice(N - 6)) }] }, { yFormat: mFmt, legendPosition: 'top-right' }));
    const cols = D.months.slice(N - 6), lc = state.cadlc === 'LC';
    document.getElementById('rev-table-title').textContent = 'Revenue by entity · recent months' + (lc ? ' · local currency' : '');
    let head = '<thead><tr><th>Entity</th>' + cols.map(c => `<th style="text-align:right;">${c}</th>`).join('') + '<th style="text-align:right;">12M total</th></tr></thead>';
    let body = actEnt().map(e => { const cur = lc ? e.ccy : state.currency;
      const cells = e.rev.slice(N - 6).map(v => `<td class="n">${moneyIn(v, cur)}</td>`).join('');
      return `<tr data-xf="${e.key}"><td class="client">${e.name}</td>${cells}<td class="n">${moneyIn(e.rev.reduce((a, b) => a + b, 0), cur)}</td></tr>`; }).join('');
    const foot = '<tfoot><tr><td class="lbl">Global [CAD]</td>' + cols.map((_, ci) => `<td>${moneyIn(actEnt().reduce((s, e) => s + e.rev[N - 6 + ci], 0), 'CAD')}</td>`).join('') + `<td>${moneyIn(g.reduce((a, b) => a + b, 0), 'CAD')}</td></tr></tfoot>`;
    document.getElementById('rev-table').innerHTML = head + '<tbody>' + body + '</tbody>' + foot;
    wireXFRows('rev-table', 'entity');
  }

  function renderClientRev() {
    setVB('vb-clientrev', segCtrl('seg-crev', 'Currency basis', [{ v: 'CAD', l: 'CAD' }, { v: 'LC', l: 'Local (LC)' }], state.cadlc));
    wireSeg('seg-crev', v => { state.cadlc = v; rebar(); });
    let rows = D.clientRevenue.filter(inEnt).sort((a, b) => b.rev - a.rev);
    const cx = xfClient(); const rowsF = cx ? rows.filter(r => r.client === cx) : rows;
    const total = rowsF.reduce((s, r) => s + r.rev, 0), topClient = rowsF[0];
    setKpis('kpi-clientrev', [
      { label: 'Client revenue', value: money(total), basis: `${rowsF.length} client${rowsF.length !== 1 ? 's' : ''} · ${D.months[LAST]}`, highlight: true, sparkId: 'sp-cr1', sparkVals: globalRev(), sparkColor: EMBER() },
      { label: 'Top client', value: topClient ? topClient.client.replace(' clients', '') : '—', basis: topClient ? `${money(topClient.rev)} · ${pct(topClient.rev / (rows.reduce((s, r) => s + r.rev, 0)))}` : '', sparkId: 'sp-cr2', sparkVals: rowsF.map(r => r.rev), slot: 1 },
      { label: 'Avg / client', value: money(total / (rowsF.length || 1)), basis: 'latest month', sparkId: 'sp-cr3', sparkVals: rowsF.map(r => r.rev), slot: 2 },
      { label: 'Entities', value: actEnt().length, basis: allEnt() ? 'all selected' : 'filtered', sparkId: 'sp-cr4', sparkVals: actEnt().map(e => e.rev[LAST]), slot: 3 },
    ]);
    const topRows = rowsF.slice(0, 10);
    draw('clientrev-chart', el => C.groupedBar(el, { categories: topRows.map(r => r.client.replace(' clients', '')), series: [{ name: 'Revenue', values: topRows.map(r => r.rev * ccy().factor) }] }, { showValues: true, valueFormatter: mFmt, legendPosition: 'top-right' }));
    bindChartXF('clientrev-chart', 'client', 'bar');
    const byEnt = actEnt().map(e => ({ label: e.name, value: rowsF.filter(r => r.entity === e.key).reduce((s, r) => s + r.rev, 0) * ccy().factor })).filter(x => x.value > 0);
    draw('clientrev-mix', el => C.donut(el, byEnt, { totalFormatter: mFmt, valueFormatter: mFmt }));
    bindChartXF('clientrev-mix', 'entity', 'donut');
    const lc = state.cadlc === 'LC';
    let head = '<thead><tr><th>Entity</th><th>Client</th><th style="text-align:right;">Revenue</th><th style="text-align:right;">% of total</th></tr></thead>';
    const grand = rows.reduce((s, r) => s + r.rev, 0);
    let body = rows.map(r => { const cur = lc ? D.entityByKey[r.entity].ccy : state.currency;
      return `<tr data-xf="${r.client}"><td>${D.entityByKey[r.entity].name}</td><td class="client">${r.client}</td><td class="n">${moneyIn(r.rev, cur)}</td><td class="n">${pct(r.rev / grand)}</td></tr>`; }).join('');
    const foot = `<tfoot><tr><td class="lbl">Total [CAD]</td><td></td><td>${moneyIn(grand, 'CAD')}</td><td>100.0%</td></tr></tfoot>`;
    document.getElementById('clientrev-table').innerHTML = head + '<tbody>' + body + '</tbody>' + foot;
    wireXFRows('clientrev-table', 'client');
  }

  function renderTopN() {
    setVB('vb-topn', sliderCtrl('sl-topn', 'Top N', 3, 15, state.topN, '') + '&nbsp;&nbsp;' + segCtrl('seg-topn', 'Currency basis', [{ v: 'CAD', l: 'CAD' }, { v: 'LC', l: 'Local (LC)' }], state.cadlc));
    wireSlider('sl-topn', '', v => { state.topN = v; rebar(); });
    wireSeg('seg-topn', v => { state.cadlc = v; rebar(); });
    const all = D.clientRevenue.filter(inEnt).filter(r => r.client !== 'Other clients').sort((a, b) => b.rev - a.rev);
    let rows = all.slice(0, state.topN);
    const cx = xfClient(); if (cx) rows = rows.filter(r => r.client === cx);
    const topTotal = rows.reduce((s, r) => s + r.rev, 0), grand = all.reduce((s, r) => s + r.rev, 0);
    document.getElementById('topn-title').textContent = `Top ${state.topN} clients.`;
    document.getElementById('topn-chart-title').textContent = `Revenue by top ${state.topN} clients`;
    setKpis('kpi-topn', [
      { label: `Top ${state.topN} revenue`, value: money(topTotal), basis: `${pct(topTotal / grand)} of client revenue`, highlight: true, sparkId: 'sp-tn1', sparkVals: rows.map(r => r.rev), sparkColor: EMBER() },
      { label: 'Leading client', value: rows[0] ? rows[0].client : '—', basis: rows[0] ? money(rows[0].rev) : '', sparkId: 'sp-tn2', sparkVals: rows.map(r => r.rev), slot: 1 },
      { label: 'Concentration', value: rows.length ? pct(rows.slice(0, 3).reduce((s, r) => s + r.rev, 0) / grand) : '—', basis: 'top 3 share', sparkId: 'sp-tn3', sparkVals: rows.map(r => r.rev), slot: 2 },
      { label: 'Clients shown', value: rows.length, basis: `of ${all.length}`, sparkId: 'sp-tn4', sparkVals: [rows.length], slot: 3 },
    ]);
    draw('topn-chart', el => C.groupedBar(el, { categories: rows.map(r => r.client), series: [{ name: 'Revenue', values: rows.map(r => r.rev * ccy().factor) }] }, { showValues: true, valueFormatter: mFmt, legendPosition: 'top-right' }));
    bindChartXF('topn-chart', 'client', 'bar');
    const lc = state.cadlc === 'LC';
    let head = '<thead><tr><th>#</th><th>Client</th><th>Entity</th><th style="text-align:right;">Revenue</th><th style="text-align:right;">% of total</th></tr></thead>';
    let body = rows.map((r, i) => { const cur = lc ? D.entityByKey[r.entity].ccy : state.currency;
      return `<tr data-xf="${r.client}"><td class="n" style="text-align:left;">${i + 1}</td><td class="client">${r.client}</td><td>${D.entityByKey[r.entity].name}</td><td class="n">${moneyIn(r.rev, cur)}</td><td class="n">${pct(r.rev / grand)}</td></tr>`; }).join('');
    document.getElementById('topn-table').innerHTML = head + '<tbody>' + body + '</tbody>';
    wireXFRows('topn-table', 'client');
  }

  function renderActPy() {
    const g = globalRev(), py = globalPY();
    const revP = periodValue(g), pyP = periodValue(py), varr = revP - pyP, yoy = pyP ? varr / pyP : 0;
    setKpis('kpi-actpy', [
      { label: `Actual · ${state.period}`, value: money(revP), basis: `vs. PY ${money(pyP)}`, sparkId: 'sp-ap1', sparkVals: g, slot: 1 },
      { label: 'Variance', value: (varr >= 0 ? '+' : '') + money(varr), basis: `${deltaHtml(revP, pyP)}`, highlight: true, sparkId: 'sp-ap2', sparkVals: g.map((v, i) => v - py[i]), sparkColor: EMBER() },
      { label: 'YoY growth', value: (yoy >= 0 ? '+' : '') + pct(yoy), basis: `${state.period}`, sparkId: 'sp-ap3', sparkVals: g.map((v, i) => py[i] ? (v - py[i]) / py[i] * 100 : 0), slot: 2 },
      { label: 'Best month', value: bestMonthYoY(g, py), basis: 'highest YoY', sparkId: 'sp-ap4', sparkVals: g, slot: 3 },
    ]);
    draw('actpy-trend', el => C.line(el, { x: D.months, series: [{ name: 'Actual', values: conv(g) }, { name: 'Prior year', values: conv(py) }] }, { yFormat: mFmt, legendPosition: 'top-right' }));
    const varPct = g.slice(N - 6).map((v, i) => { const p = py[N - 6 + i]; return p ? (v - p) / p * 100 : 0; });
    draw('actpy-var', el => C.groupedBar(el, { categories: D.months.slice(N - 6), series: [{ name: 'YoY %', values: varPct }] }, { showValues: true, valueFormatter: v => v.toFixed(0) + '%', legendPosition: 'top-right' }));
    let head = '<thead><tr><th>Entity</th><th style="text-align:right;">Actual</th><th style="text-align:right;">Prior year</th><th style="text-align:right;">Variance</th><th style="text-align:right;">YoY %</th></tr></thead>';
    let body = actEnt().map(e => { const a = periodValue(e.rev), p = periodValue(e.rev.map(v => v * e.pyF)), vv = a - p;
      return `<tr data-xf="${e.key}"><td class="client">${e.name}</td><td class="n">${money(a)}</td><td class="n">${money(p)}</td><td class="n">${(vv >= 0 ? '+' : '') + money(vv)}</td><td class="n">${deltaHtml(a, p)}</td></tr>`; }).join('');
    const foot = `<tfoot><tr><td class="lbl">Global</td><td>${money(revP)}</td><td>${money(pyP)}</td><td>${(varr >= 0 ? '+' : '') + money(varr)}</td><td>${(yoy >= 0 ? '+' : '') + pct(yoy)}</td></tr></tfoot>`;
    document.getElementById('actpy-table').innerHTML = head + '<tbody>' + body + '</tbody>' + foot;
    wireXFRows('actpy-table', 'entity');
  }
  function bestMonthYoY(g, py) { let bi = D.fiscalStartIndex, bv = -Infinity; g.forEach((v, i) => { const p = py[i]; const r = p ? (v - p) / p : 0; if (i >= D.fiscalStartIndex && r > bv) { bv = r; bi = i; } }); return D.months[bi]; }

  function renderResource() {
    let ppl = D.people.filter(inEnt); const px = xfPerson(); const pplF = px ? ppl.filter(p => p.name === px) : ppl;
    const avgBill = pplF.length ? pplF.reduce((s, p) => s + p.bill, 0) / pplF.length : 0;
    const under = pplF.filter(p => p.bill < 0.6).length;
    setKpis('kpi-resource', [
      { label: 'Company billability', value: pct(D.resAllStaff[7]), basis: `${deltaHtml(D.resAllStaff[7], D.resAllStaff[6])} · vs. last week`, highlight: true, sparkId: 'sp-rm1', sparkVals: D.resAllStaff.map(x => x * 100), sparkColor: EMBER() },
      { label: 'Consultants', value: pct(D.resConsultants[7]), basis: `${deltaHtml(D.resConsultants[7], D.resConsultants[6])} · vs. last week`, sparkId: 'sp-rm2', sparkVals: D.resConsultants.map(x => x * 100), slot: 1 },
      { label: px ? 'Selected' : 'Avg / person', value: pct(avgBill), basis: `${pplF.length} staff`, sparkId: 'sp-rm3', sparkVals: pplF.map(p => p.bill * 100), slot: 2 },
      { label: 'Under 60%', value: under, basis: 'staff under-utilized', sparkId: 'sp-rm4', sparkVals: [under], slot: 3 },
    ]);
    draw('res-trend', el => C.line(el, { x: D.weeks, series: [{ name: 'All staff', values: D.resAllStaff.map(x => x * 100) }, { name: 'Consultants', values: D.resConsultants.map(x => x * 100) }] }, { yFormat: v => v.toFixed(0) + '%', legendPosition: 'top-right' }));
    const byEnt = actEnt().map(e => { const g = ppl.filter(p => p.entity === e.key); return { name: e.name.replace('MMR ', ''), v: g.length ? g.reduce((s, p) => s + p.bill, 0) / g.length : 0 }; }).filter(x => x.v > 0);
    draw('res-entity', el => C.groupedBar(el, { categories: byEnt.map(x => x.name), series: [{ name: 'Billability %', values: byEnt.map(x => x.v * 100) }] }, { showValues: true, valueFormatter: pFmt, legendPosition: 'top-right' }));
    bindChartXF('res-entity', 'entity', 'bar');
    let head = '<thead><tr><th>Consultant</th><th>Entity</th><th>Type</th><th style="text-align:right;">Billability</th><th style="text-align:right;">Week of supply</th></tr></thead>';
    let body = pplF.slice().sort((a, b) => a.bill - b.bill).map(p => `<tr data-xf="${p.name}"><td class="client">${p.name}</td><td>${D.entityByKey[p.entity].name}</td><td>${p.type}</td><td class="n">${pct(p.bill)}</td><td class="n">${(p.remaining / 40).toFixed(1)} wk</td></tr>`).join('');
    document.getElementById('res-table').innerHTML = head + '<tbody>' + body + '</tbody>';
    wireXFRows('res-table', 'person');
  }

  function renderBillability() {
    setVB('vb-billability', sliderCtrl('sl-fte', 'FTE hours/mo', 120, 200, state.fteParam, ''));
    wireSlider('sl-fte', '', v => { state.fteParam = v; rebar(); });
    const bh = billableHrs(), nh = nonBillableHrs();
    setKpis('kpi-bill', [
      { label: 'Billability', value: pct(D.billability[LAST]), basis: `${deltaHtml(D.billability[LAST], D.billability[LAST - 1])} · vs. prior month`, highlight: true, sparkId: 'sp-b1', sparkVals: D.billability.map(x => x * 100), sparkColor: EMBER() },
      { label: 'Billable hours', value: hFmt(bh[LAST]), basis: D.months[LAST], sparkId: 'sp-b2', sparkVals: bh, slot: 1 },
      { label: 'Non-billable', value: hFmt(nh[LAST]), basis: `${pct(nh[LAST] / (bh[LAST] + nh[LAST]))} of logged`, sparkId: 'sp-b3', sparkVals: nh, slot: 2 },
      { label: 'Revenue / FTE', value: moneyK(globalRev()[LAST] * 1000 / fteAdj(LAST)), basis: `FTE hrs/mo ${state.fteParam}`, sparkId: 'sp-b4', sparkVals: globalRev().map((v, i) => v * 1000 / fteAdj(i)), slot: 3 },
    ]);
    draw('bill-trend', el => C.line(el, { x: D.months, series: [{ name: 'Billable', values: bh }, { name: 'Non-billable', values: nh }] }, { yFormat: hFmt, legendPosition: 'top-right' }));
    draw('bill-cat', el => C.donut(el, D.nonBillableByCategory, { totalFormatter: hFmt, valueFormatter: hFmt }));
    draw('bill-entity', el => C.groupedBar(el, { categories: actEnt().map(e => e.name.replace('MMR ', '')), series: [{ name: 'Billability %', values: actEnt().map(e => (D.billabilityByEntity.find(b => b.key === e.key) || { value: 0 }).value * 100) }] }, { showValues: true, valueFormatter: pFmt, legendPosition: 'top-right' }));
    bindChartXF('bill-entity', 'entity', 'bar');
  }

  function renderBillableHrs() {
    setVB('vb-billablehrs', sliderCtrl('sl-fte2', 'FTE hours/mo', 120, 200, state.fteParam, ''));
    wireSlider('sl-fte2', '', v => { state.fteParam = v; rebar(); });
    const bh = billableHrs(), nh = nonBillableHrs();
    setKpis('kpi-billablehrs', [
      { label: 'Billable hours', value: hFmt(bh[LAST]), basis: `${deltaHtml(bh[LAST], bh[LAST - 1])} · vs. prior month`, highlight: true, sparkId: 'sp-bh1', sparkVals: bh, sparkColor: EMBER() },
      { label: 'Billable %', value: pct(D.billability[LAST]), basis: 'of logged hours', sparkId: 'sp-bh2', sparkVals: D.billability.map(x => x * 100), slot: 1 },
      { label: 'FTE (adj)', value: num(fteAdj(LAST), 0), basis: `hrs/mo ${state.fteParam}`, sparkId: 'sp-bh3', sparkVals: D.fte.map((_, i) => fteAdj(i)), slot: 2 },
      { label: 'Time off', value: hFmt(D.fte[LAST] * 6), basis: 'latest month', sparkId: 'sp-bh4', sparkVals: D.fte.map(f => f * 6), slot: 3 },
    ]);
    draw('billhrs-trend', el => C.line(el, { x: D.months, series: [{ name: 'Billable', values: bh }, { name: 'Non-billable', values: nh }] }, { yFormat: hFmt, legendPosition: 'top-right' }));
    const cols = D.months.slice(N - 6);
    let head = '<thead><tr><th>Metric</th>' + cols.map(c => `<th style="text-align:right;">${c}</th>`).join('') + '</tr></thead>';
    const rowsDef = [
      ['Billable hours', bh.slice(N - 6).map(hFmt)], ['Non-billable hours', nh.slice(N - 6).map(hFmt)],
      ['Billable %', D.billability.slice(N - 6).map(x => pct(x))], ['FTE (adj)', D.fte.slice(N - 6).map((_, i) => num(fteAdj(N - 6 + i), 0))],
      ['Revenue / FTE', globalRev().slice(N - 6).map((v, i) => moneyK(v * 1000 / fteAdj(N - 6 + i)))],
    ];
    document.getElementById('billhrs-table').innerHTML = head + '<tbody>' + rowsDef.map(r => `<tr><td class="client">${r[0]}</td>${r[1].map(c => `<td class="n">${c}</td>`).join('')}</tr>`).join('') + '</tbody>';
  }

  function renderNonBillable() {
    const cats = D.nonBillableByCategory, factor = [0.86, 0.90, 0.92, 0.95, 0.97, 1.0];
    const total = cats.reduce((s, c) => s + c.value, 0);
    setKpis('kpi-nonbill', [
      { label: 'Non-billable hours', value: hFmt(total), basis: D.months[LAST], highlight: true, sparkId: 'sp-nb1', sparkVals: factor.map(f => total * f), sparkColor: EMBER() },
      { label: 'Top category', value: cats[0].label, basis: `${hFmt(cats[0].value)} h`, sparkId: 'sp-nb2', sparkVals: cats.map(c => c.value), slot: 1 },
      { label: 'Categories', value: cats.length, basis: 'grouping keys', sparkId: 'sp-nb3', sparkVals: cats.map(c => c.value), slot: 2 },
      { label: 'Non-billable %', value: pct(nonBillableHrs()[LAST] / (billableHrs()[LAST] + nonBillableHrs()[LAST])), basis: 'of logged', sparkId: 'sp-nb4', sparkVals: D.billability.map(x => (1 - x) * 100), slot: 3 },
    ]);
    const cols = D.months.slice(N - 6);
    draw('nonbill-trend', el => C.line(el, { x: cols, series: cats.slice(0, 4).map(c => ({ name: c.label, values: factor.map(f => Math.round(c.value * f)) })) }, { yFormat: hFmt, legendPosition: 'top-right' }));
    draw('nonbill-cat', el => C.donut(el, cats, { totalFormatter: hFmt, valueFormatter: hFmt }));
    let head = '<thead><tr><th>Category</th>' + cols.map(c => `<th style="text-align:right;">${c}</th>`).join('') + '<th style="text-align:right;">Latest</th></tr></thead>';
    let body = cats.map(c => `<tr><td class="client">${c.label}</td>${factor.map(f => `<td class="n">${hFmt(Math.round(c.value * f))}</td>`).join('')}<td class="n">${hFmt(c.value)}</td></tr>`).join('');
    const foot = '<tfoot><tr><td class="lbl">Total</td>' + factor.map(f => `<td>${hFmt(Math.round(total * f))}</td>`).join('') + `<td>${hFmt(total)}</td></tr></tfoot>`;
    document.getElementById('nonbill-table').innerHTML = head + '<tbody>' + body + '</tbody>' + foot;
  }

  function renderWos() {
    let ppl = D.people.filter(inEnt); const px = xfPerson(); const pplF = px ? ppl.filter(p => p.name === px) : ppl;
    const totRemain = pplF.reduce((s, p) => s + p.remaining, 0);
    const avgWos = pplF.length ? pplF.reduce((s, p) => s + p.remaining / 40, 0) / pplF.length : 0;
    setKpis('kpi-wos', [
      { label: 'Avg week of supply', value: avgWos.toFixed(1) + ' wk', basis: `${pplF.length} consultant${pplF.length !== 1 ? 's' : ''}`, highlight: true, sparkId: 'sp-ws1', sparkVals: pplF.map(p => p.remaining / 40), sparkColor: EMBER() },
      { label: 'Hours remaining', value: hFmt(totRemain), basis: 'budgeted − consumed', sparkId: 'sp-ws2', sparkVals: pplF.map(p => p.remaining), slot: 1 },
      { label: 'Budgeted hours', value: hFmt(pplF.reduce((s, p) => s + p.budgeted, 0)), basis: 'in-progress', sparkId: 'sp-ws3', sparkVals: pplF.map(p => p.budgeted), slot: 2 },
      { label: 'Under 2 wks', value: pplF.filter(p => p.remaining / 40 < 2).length, basis: 'need pipeline', sparkId: 'sp-ws4', sparkVals: pplF.map(p => p.remaining / 40), slot: 3 },
    ]);
    const sorted = pplF.slice().sort((a, b) => b.remaining - a.remaining);
    draw('wos-chart', el => C.groupedBar(el, { categories: sorted.map(p => p.name), series: [{ name: 'Weeks of supply', values: sorted.map(p => +(p.remaining / 40).toFixed(1)) }] }, { showValues: true, valueFormatter: v => v.toFixed(1), legendPosition: 'top-right' }));
    bindChartXF('wos-chart', 'person', 'bar');
    let head = '<thead><tr><th>Consultant</th><th>Entity</th><th style="text-align:right;">Budgeted</th><th style="text-align:right;">Consumed</th><th style="text-align:right;">Remaining</th><th style="text-align:right;">Week of supply</th></tr></thead>';
    let body = sorted.map(p => `<tr data-xf="${p.name}"><td class="client">${p.name}</td><td>${D.entityByKey[p.entity].name}</td><td class="n">${hFmt(p.budgeted)}</td><td class="n">${hFmt(p.duration)}</td><td class="n">${hFmt(p.remaining)}</td><td class="n">${(p.remaining / 40).toFixed(1)} wk</td></tr>`).join('');
    document.getElementById('wos-table').innerHTML = head + '<tbody>' + body + '</tbody>';
    wireXFRows('wos-table', 'person');
  }

  function renderHoursRemaining() {
    setVB('vb-hoursremaining', sliderCtrl('sl-hours', 'Max hours', 40, 320, state.hoursParam, ' h'));
    wireSlider('sl-hours', ' h', v => { state.hoursParam = v; rebar(); });
    const rows = D.hoursRemaining.filter(r => { const p = D.people.find(pp => pp.name === r.user); return (!p || inEnt(p)) && r.remaining <= state.hoursParam; });
    const byUser = {}; rows.forEach(r => { (byUser[r.user] = byUser[r.user] || []).push(r); });
    const sum = arr => arr.reduce((s, r) => s + r.remaining, 0);
    const users = Object.keys(byUser).sort((a, b) => sum(byUser[b]) - sum(byUser[a]));
    const grand = rows.reduce((s, r) => s + r.remaining, 0);
    setKpis('kpi-hours', [
      { label: 'Hours remaining', value: hFmt(grand), basis: `${users.length} employees · ≤ ${state.hoursParam}h`, highlight: true, sparkId: 'sp-hr1', sparkVals: users.map(u => sum(byUser[u])), sparkColor: EMBER() },
      { label: 'Employees', value: users.length, basis: 'with open work', sparkId: 'sp-hr2', sparkVals: [users.length], slot: 1 },
      { label: 'Tasks', value: rows.length, basis: 'open tasks', sparkId: 'sp-hr3', sparkVals: [rows.length], slot: 2 },
      { label: 'Avg / employee', value: hFmt(users.length ? grand / users.length : 0), basis: 'remaining hours', sparkId: 'sp-hr4', sparkVals: users.map(u => sum(byUser[u])), slot: 3 },
    ]);
    let head = '<thead><tr><th>Employee → Client · Project · Task</th><th style="text-align:right;">Remaining hours</th></tr></thead>';
    let body = users.map(u => { const open = state.hoursExpanded.has(u);
      const grp = `<tr class="grp" data-user="${u}"><td class="client"><span class="tw">${open ? '▾' : '▸'}</span>${u}</td><td class="n">${hFmt(sum(byUser[u]))}</td></tr>`;
      const kids = open ? byUser[u].map(r => `<tr><td class="sub">${r.client} · ${r.project} · ${r.task}</td><td class="n">${hFmt(r.remaining)}</td></tr>`).join('') : '';
      return grp + kids; }).join('');
    const tbl = document.getElementById('hours-table');
    tbl.innerHTML = head + '<tbody>' + body + '</tbody>' + `<tfoot><tr><td class="lbl">All employees</td><td>${hFmt(grand)}</td></tr></tfoot>`;
    tbl.querySelectorAll('tr.grp').forEach(tr => tr.onclick = () => { const u = tr.dataset.user; if (state.hoursExpanded.has(u)) state.hoursExpanded.delete(u); else state.hoursExpanded.add(u); renderHoursRemaining(); });
  }

  function renderBacklog() {
    let users = D.backlogUsers.filter(u => { const p = D.people.find(pp => pp.name === u.user); return !p || inEnt(p); });
    const px = xfPerson(); const usersF = px ? users.filter(u => u.user === px) : users;
    const li = D.backlogMonths.length - 1;
    const avg = usersF.length ? usersF.reduce((s, u) => s + u.v[li], 0) / usersF.length : 0;
    const top = usersF.slice().sort((a, b) => b.v[li] - a.v[li])[0];
    setKpis('kpi-backlog', [
      { label: 'Avg backlog', value: avg.toFixed(1) + ' mo', basis: `${usersF.length} consultant${usersF.length !== 1 ? 's' : ''} · ${D.backlogMonths[li]}`, highlight: true, sparkId: 'sp-bk1', sparkVals: usersF.map(u => u.v[li]), sparkColor: EMBER() },
      { label: 'Highest', value: top ? top.v[li].toFixed(1) + ' mo' : '—', basis: top ? top.user : '', sparkId: 'sp-bk2', sparkVals: usersF.map(u => u.v[li]), slot: 1 },
      { label: 'Under 1 mo', value: usersF.filter(u => u.v[li] < 1).length, basis: 'low backlog', sparkId: 'sp-bk3', sparkVals: usersF.map(u => u.v[li]), slot: 2 },
      { label: 'Consultants', value: usersF.length, basis: 'tracked', sparkId: 'sp-bk4', sparkVals: [usersF.length], slot: 3 },
    ]);
    const sorted = usersF.slice().sort((a, b) => b.v[li] - a.v[li]);
    draw('backlog-chart', el => C.groupedBar(el, { categories: sorted.map(u => u.user), series: [{ name: 'Backlog months', values: sorted.map(u => u.v[li]) }] }, { showValues: true, valueFormatter: v => v.toFixed(1), legendPosition: 'top-right' }));
    bindChartXF('backlog-chart', 'person', 'bar');
    let head = '<thead><tr><th>Consultant</th>' + D.backlogMonths.map(m => `<th style="text-align:right;">${m}</th>`).join('') + '</tr></thead>';
    let body = sorted.map(u => `<tr data-xf="${u.user}"><td class="client">${u.user}</td>${u.v.map(v => `<td class="n">${v.toFixed(1)}</td>`).join('')}</tr>`).join('');
    document.getElementById('backlog-table').innerHTML = head + '<tbody>' + body + '</tbody>';
    wireXFRows('backlog-table', 'person');
  }

  function renderUnassigned() {
    let projs = D.unassignedProjects.filter(inEnt).map(p => { const val = Math.max(0, p.po - p.exp - p.hrBudget); return Object.assign({}, p, { val, hrs: val * 1e6 / D.blendedRateCAD }); }).sort((a, b) => b.val - a.val);
    const prj = xfProject(); const projsF = prj ? projs.filter(p => p.project === prj) : projs;
    const totVal = projsF.reduce((s, p) => s + p.val, 0), totHrs = projsF.reduce((s, p) => s + p.hrs, 0);
    setKpis('kpi-unassigned', [
      { label: 'Unassigned value', value: money(totVal), basis: `${projsF.length} project${projsF.length !== 1 ? 's' : ''}`, highlight: true, sparkId: 'sp-ua1', sparkVals: D.unassignedMonthly, sparkColor: EMBER() },
      { label: 'Unassigned hours', value: hFmt(totHrs), basis: `@ ${D.blendedRateCAD} CAD/hr`, sparkId: 'sp-ua2', sparkVals: projsF.map(p => p.hrs), slot: 1 },
      { label: 'PO value', value: money(projsF.reduce((s, p) => s + p.po, 0)), basis: 'total contract', sparkId: 'sp-ua3', sparkVals: projsF.map(p => p.po), slot: 2 },
      { label: 'Top project', value: projsF[0] ? money(projsF[0].val) : '—', basis: projsF[0] ? projsF[0].project.split(' · ')[0] : '', sparkId: 'sp-ua4', sparkVals: projsF.map(p => p.val), slot: 3 },
    ]);
    draw('unassigned-chart', el => C.groupedBar(el, { categories: projsF.map(p => p.project), series: [{ name: 'Unassigned value', values: projsF.map(p => p.val * ccy().factor) }] }, { showValues: true, valueFormatter: mFmt, legendPosition: 'top-right' }));
    bindChartXF('unassigned-chart', 'project', 'bar');
    let head = '<thead><tr><th>Project</th><th>Entity</th><th style="text-align:right;">PO value</th><th style="text-align:right;">Expenses</th><th style="text-align:right;">Assigned</th><th style="text-align:right;">Unassigned $</th><th style="text-align:right;">Unassigned hrs</th></tr></thead>';
    let body = projs.map(p => `<tr data-xf="${p.project}"><td class="client">${p.project}</td><td>${D.entityByKey[p.entity].name}</td><td class="n">${money(p.po)}</td><td class="n">${money(p.exp)}</td><td class="n">${money(p.hrBudget)}</td><td class="n">${money(p.val)}</td><td class="n">${hFmt(p.hrs)}</td></tr>`).join('');
    const foot = `<tfoot><tr><td class="lbl">Total</td><td></td><td>${money(projs.reduce((s, p) => s + p.po, 0))}</td><td>${money(projs.reduce((s, p) => s + p.exp, 0))}</td><td>${money(projs.reduce((s, p) => s + p.hrBudget, 0))}</td><td>${money(projs.reduce((s, p) => s + p.val, 0))}</td><td>${hFmt(projs.reduce((s, p) => s + p.hrs, 0))}</td></tr></tfoot>`;
    document.getElementById('unassigned-table').innerHTML = head + '<tbody>' + body + '</tbody>' + foot;
    wireXFRows('unassigned-table', 'project');
  }

  /* ---------- AR ---------- */
  const BK = { 'Not Overdue': 'notOverdue', '1–30 days': 'd30', '31–60 days': 'd60', '61–90 days': 'd90', '91–120 days': 'd120', '> 120 days': 'over120' };
  function arClientsAct() { return D.arClients.filter(inEnt); }
  function arScale() { const base = D.arTotal[LAST]; return base ? D.arTotal[state.asOf] / base : 1; }
  function arBucketsAct() { const s = arScale();
    if (allEnt()) return D.arBuckets.map(b => ({ label: b.label, value: b.value * s }));
    const cl = arClientsAct(); const sum = k => cl.reduce((a, c) => a + c[k], 0) / 1000 * s;
    return [{ label: 'Not Overdue', value: sum('notOverdue') }, { label: '1–30 days', value: sum('d30') }, { label: '31–60 days', value: sum('d60') },
      { label: '61–90 days', value: sum('d90') }, { label: '91–120 days', value: sum('d120') }, { label: '> 120 days', value: sum('over120') }]; }

  function renderAR() {
    setVB('vb-ar', asOfCtrl('sel-asof-ar', state.asOf));
    document.getElementById('sel-asof-ar').onchange = e => { state.asOf = +e.target.value; rebar(); };
    const buckets = arBucketsAct(), tot = buckets.reduce((s, b) => s + b.value, 0), notO = buckets[0].value, ovd = tot - notO;
    document.getElementById('ar-eyebrow').textContent = `Accounts receivable · as of ${D.months[state.asOf]} · ${state.currency}`;
    setKpis('kpi-ar', [
      { label: 'Total AR', value: money(tot), basis: `as of ${D.months[state.asOf]}`, sparkId: 'sp-a1', sparkVals: D.arTotal, slot: 1 },
      { label: 'Overdue AR', value: money(ovd), basis: `${pct(ovd / tot)} of total`, highlight: true, sparkId: 'sp-a2', sparkVals: D.arOverdue, sparkColor: EMBER() },
      { label: '% Overdue', value: pct(ovd / tot), basis: `${deltaHtml(D.arOverdue[state.asOf] / D.arTotal[state.asOf], D.arOverdue[state.asOf - 1] / D.arTotal[state.asOf - 1])} · vs. prior mo`, sparkId: 'sp-a3', sparkVals: D.arOverdue.map((v, i) => v / D.arTotal[i] * 100), slot: 3 },
      { label: 'Not overdue', value: money(notO), basis: `${pct(notO / tot)} of total`, sparkId: 'sp-a4', sparkVals: D.arTotal.map((v, i) => v - D.arOverdue[i]), slot: 4 },
    ]);
    draw('ar-buckets', el => C.donut(el, buckets.map(b => ({ label: b.label, value: b.value * ccy().factor })), { totalFormatter: mFmt, valueFormatter: mFmt }));
    bindChartXF('ar-buckets', 'bucket', 'donut');
    draw('ar-ttm', el => C.line(el, { x: D.months, series: [{ name: 'Total AR', values: conv(D.arTotal) }, { name: 'Overdue AR', values: conv(D.arOverdue) }] }, { yFormat: mFmt, legendPosition: 'top-right' }));
    const s = arScale(), bk = xfBucket();
    const titleEl = document.querySelector('#view-ar .card:last-child .card-header h4');
    if (bk && BK[bk]) {
      if (titleEl) titleEl.textContent = 'AR by client · ' + bk;
      const rows = arClientsAct().map(c => ({ name: c.name, v: c[BK[bk]] * s })).sort((a, b) => b.v - a.v);
      const grand = rows.reduce((a, r) => a + r.v, 0);
      let head = '<thead><tr><th>Client</th><th style="text-align:right;">' + bk + '</th><th style="text-align:right;">% of bucket</th></tr></thead>';
      let body = rows.map(r => `<tr><td class="client">${r.name}</td><td class="n">${moneyK(r.v)}</td><td class="n">${pct(grand ? r.v / grand : 0)}</td></tr>`).join('');
      document.getElementById('ar-table').innerHTML = head + '<tbody>' + body + '</tbody>' + `<tfoot><tr><td class="lbl">All clients</td><td>${moneyK(grand)}</td><td>100.0%</td></tr></tfoot>`;
    } else {
      if (titleEl) titleEl.textContent = 'AR by client';
      const rows = arClientsAct().map(c => { const b = [c.notOverdue, c.d30, c.d60, c.d90, c.d120, c.over120].map(v => v * s); return { name: c.name, b, total: b.reduce((a, x) => a + x, 0) }; }).sort((a, b) => b.total - a.total);
      const heads = ['Not Overdue', '1–30', '31–60', '61–90', '91–120', '&gt; 120', 'Total'];
      let head = '<thead><tr><th>Client</th>' + heads.map(h => `<th style="text-align:right;">${h}</th>`).join('') + '</tr></thead>';
      let body = rows.map(r => `<tr><td class="client">${r.name}</td>` + r.b.map(v => `<td class="n">${moneyK(v)}</td>`).join('') + `<td class="n">${moneyK(r.total)}</td></tr>`).join('');
      const sums = [0, 1, 2, 3, 4, 5].map(ci => rows.reduce((a, r) => a + r.b[ci], 0)), grand = sums.reduce((a, b) => a + b, 0);
      document.getElementById('ar-table').innerHTML = head + '<tbody>' + body + '</tbody>' + '<tfoot><tr><td class="lbl">All clients</td>' + sums.map(v => `<td>${moneyK(v)}</td>`).join('') + `<td>${moneyK(grand)}</td></tr></tfoot>`;
    }
  }

  function renderArByType() {
    setVB('vb-arbytype', asOfCtrl('sel-asof-t', state.asOf));
    document.getElementById('sel-asof-t').onchange = e => { state.asOf = +e.target.value; rebar(); };
    const buckets = arBucketsAct(), tot = buckets.reduce((s, b) => s + b.value, 0), ovd = tot - buckets[0].value;
    document.getElementById('arbytype-eyebrow').textContent = `Accounts receivable · as of ${D.months[state.asOf]} · ${state.currency}`;
    const bk = xfBucket();
    setKpis('kpi-arbytype', [
      { label: bk ? 'Selected bucket' : 'Total AR', value: bk ? money((buckets.find(b => b.label === bk) || { value: 0 }).value) : money(tot), basis: bk ? bk : `as of ${D.months[state.asOf]}`, sparkId: 'sp-t1', sparkVals: D.arTotal, slot: 1 },
      { label: 'Overdue', value: money(ovd), basis: `${pct(ovd / tot)}`, highlight: true, sparkId: 'sp-t2', sparkVals: D.arOverdue, sparkColor: EMBER() },
      { label: 'Buckets', value: buckets.length, basis: 'aging categories', sparkId: 'sp-t3', sparkVals: buckets.map(b => b.value), slot: 2 },
      { label: 'Clients', value: arClientsAct().length, basis: 'with balance', sparkId: 'sp-t4', sparkVals: arClientsAct().map(c => c.notOverdue), slot: 3 },
    ]);
    draw('arbytype-pie', el => C.donut(el, buckets.map(b => ({ label: b.label, value: b.value * ccy().factor })), { totalFormatter: mFmt, valueFormatter: mFmt }));
    bindChartXF('arbytype-pie', 'bucket', 'donut');
    const s = arScale();
    const cl = arClientsAct().map(c => ({ label: c.name, value: (c.notOverdue + c.d30 + c.d60 + c.d90 + c.d120 + c.over120) / 1000 * s * ccy().factor })).sort((a, b) => b.value - a.value);
    draw('arbyclient-pie', el => C.donut(el, cl, { totalFormatter: mFmt, valueFormatter: mFmt }));
    let head = '<thead><tr><th>Aging type</th><th style="text-align:right;">Amount</th><th style="text-align:right;">% of total</th></tr></thead>';
    let body = buckets.map(b => `<tr data-xf="${b.label}"><td class="client">${b.label}</td><td class="n">${money(b.value)}</td><td class="n">${pct(b.value / tot)}</td></tr>`).join('');
    document.getElementById('arbytype-table').innerHTML = head + '<tbody>' + body + '</tbody>' + `<tfoot><tr><td class="lbl">Total</td><td>${money(tot)}</td><td>100.0%</td></tr></tfoot>`;
    wireXFRows('arbytype-table', 'bucket');
  }

  function renderTtmAr() {
    const notO = D.arTotal.map((t, i) => t - D.arOverdue[i]);
    const g = globalRev();
    const ovdRev = D.arOverdue.map((o, i) => g[i] ? o / g[i] : 0);
    setKpis('kpi-ttmar', [
      { label: 'Total AR', value: money(D.arTotal[LAST]), basis: D.months[LAST], sparkId: 'sp-tm1', sparkVals: D.arTotal, slot: 1 },
      { label: 'Overdue AR', value: money(D.arOverdue[LAST]), basis: `${pct(D.arOverdue[LAST] / D.arTotal[LAST])}`, highlight: true, sparkId: 'sp-tm2', sparkVals: D.arOverdue, sparkColor: EMBER() },
      { label: 'Inventory', value: money(D.arInventory[LAST]), basis: 'unbilled (month end)', sparkId: 'sp-tm3', sparkVals: D.arInventory, slot: 2 },
      { label: 'Overdue / Revenue', value: pct(ovdRev[LAST]), basis: 'latest month', sparkId: 'sp-tm4', sparkVals: ovdRev.map(x => x * 100), slot: 3 },
    ]);
    draw('ttmar-combo', el => C.line(el, { x: D.months, series: [{ name: 'Overdue AR', values: conv(D.arOverdue) }, { name: 'Not overdue', values: conv(notO) }, { name: 'Revenue', values: conv(g) }] }, { yFormat: mFmt, legendPosition: 'top-right' }));
    const defs = [['Overdue AR', D.arOverdue], ['Not overdue AR', notO], ['Total AR', D.arTotal], ['Revenue (month end)', g], ['Inventory (month end)', D.arInventory]];
    const cols = D.months.slice(N - 6);
    let head = '<thead><tr><th>Metric</th>' + cols.map(c => `<th style="text-align:right;">${c}</th>`).join('') + '</tr></thead>';
    let body = defs.map(d => `<tr><td class="client">${d[0]}</td>${d[1].slice(N - 6).map(v => `<td class="n">${money(v)}</td>`).join('')}</tr>`).join('');
    body += '<tr><td class="client">Overdue AR / Revenue</td>' + cols.map((_, i) => { const idx = N - 6 + i; return `<td class="n">${pct(g[idx] ? D.arOverdue[idx] / g[idx] : 0)}</td>`; }).join('') + '</tr>';
    document.getElementById('ttmar-table').innerHTML = head + '<tbody>' + body + '</tbody>';
  }

  function renderWC() {
    const wc = D.currentAssets.map((ca, i) => ca - D.currentLiabilities[i]), wcCash = wc.map((v, i) => v + D.cash[i]);
    const ratio = D.currentAssets[LAST] / D.currentLiabilities[LAST];
    document.getElementById('wc-eyebrow').textContent = `Balance sheet · ${state.currency}`;
    setKpis('kpi-wc', [
      { label: 'Working capital', value: money(wcCash[LAST]), basis: `${deltaHtml(wcCash[LAST], wcCash[LAST - 1])} · with cash`, highlight: true, sparkId: 'sp-w1', sparkVals: wcCash, sparkColor: EMBER() },
      { label: 'Cash & equivalents', value: money(D.cash[LAST]), basis: `${deltaHtml(D.cash[LAST], D.cash[0])} · vs. 12m ago`, sparkId: 'sp-w2', sparkVals: D.cash, slot: 1 },
      { label: 'Total equity', value: money(D.equity[LAST]), basis: `${deltaHtml(D.equity[LAST], D.equity[0])} · vs. 12m ago`, sparkId: 'sp-w3', sparkVals: D.equity, slot: 2 },
      { label: 'Current ratio', value: ratio.toFixed(2) + '×', basis: 'assets ÷ liabilities', sparkId: 'sp-w4', sparkVals: D.currentAssets.map((v, i) => v / D.currentLiabilities[i]), slot: 3 },
    ]);
    draw('wc-trend', el => C.line(el, { x: D.months, series: [{ name: 'Cash', values: conv(D.cash) }, { name: 'Equity', values: conv(D.equity) }, { name: 'Working capital', values: conv(wcCash) }] }, { yFormat: mFmt, legendPosition: 'top-right' }));
    draw('wc-components', el => C.line(el, { x: D.months.slice(N - 6), series: [{ name: 'Current assets', values: conv(D.currentAssets.slice(N - 6)) }, { name: 'Current liabilities', values: conv(D.currentLiabilities.slice(N - 6)) }] }, { yFormat: mFmt, legendPosition: 'top-right' }));
    draw('wc-entity', el => C.groupedBar(el, { categories: actEnt().map(e => e.name.replace('MMR ', '')), series: [{ name: 'Working capital', values: actEnt().map(e => (D.wcByEntity.find(w => w.key === e.key) || { value: 0 }).value * ccy().factor) }] }, { showValues: true, valueFormatter: mFmt, legendPosition: 'top-right' }));
    bindChartXF('wc-entity', 'entity', 'bar');
  }

  function renderAssets() {
    document.getElementById('assets-eyebrow').textContent = `Balance sheet · ${state.currency}`;
    const ratio = D.currentAssets[LAST] / D.currentLiabilities[LAST];
    setKpis('kpi-assets', [
      { label: 'Current assets', value: money(D.currentAssets[LAST]), basis: `${deltaHtml(D.currentAssets[LAST], D.currentAssets[0])} · vs. 12m ago`, highlight: true, sparkId: 'sp-as1', sparkVals: D.currentAssets, sparkColor: EMBER() },
      { label: 'Current liabilities', value: money(D.currentLiabilities[LAST]), basis: `${deltaHtml(D.currentLiabilities[LAST], D.currentLiabilities[0])} · vs. 12m ago`, sparkId: 'sp-as2', sparkVals: D.currentLiabilities, slot: 1 },
      { label: 'Cash', value: money(D.cash[LAST]), basis: 'latest month', sparkId: 'sp-as3', sparkVals: D.cash, slot: 2 },
      { label: 'Current ratio', value: ratio.toFixed(2) + '×', basis: 'assets ÷ liabilities', sparkId: 'sp-as4', sparkVals: D.currentAssets.map((v, i) => v / D.currentLiabilities[i]), slot: 3 },
    ]);
    draw('assets-trend', el => C.line(el, { x: D.months, series: [{ name: 'Current assets', values: conv(D.currentAssets) }, { name: 'Current liabilities', values: conv(D.currentLiabilities) }, { name: 'Cash', values: conv(D.cash) }] }, { yFormat: mFmt, legendPosition: 'top-right' }));
    const defs = [['Total current assets', D.currentAssets], ['Total current liabilities', D.currentLiabilities], ['Cash & equivalents', D.cash], ['Total equity', D.equity]];
    const cols = D.months.slice(N - 6);
    let head = '<thead><tr><th>Account</th>' + cols.map(c => `<th style="text-align:right;">${c}</th>`).join('') + '</tr></thead>';
    document.getElementById('assets-table').innerHTML = head + '<tbody>' + defs.map(d => `<tr><td class="client">${d[0]}</td>${d[1].slice(N - 6).map(v => `<td class="n">${money(v)}</td>`).join('')}</tr>`).join('') + '</tbody>';
  }

  function renderFx() {
    const latest = D.fxRates.map(r => ({ to: r.to, v: r.values[LAST], prev: r.values[LAST - 1] }));
    setKpis('kpi-fx', [
      { label: 'CAD → USD', value: latest[0].v.toFixed(4), basis: `${deltaHtml(latest[0].v, latest[0].prev)} · vs. prior mo`, highlight: true, sparkId: 'sp-fx1', sparkVals: D.fxRates[0].values, sparkColor: EMBER() },
      { label: 'CAD → INR', value: latest[1].v.toFixed(2), basis: `${deltaHtml(latest[1].v, latest[1].prev)}`, sparkId: 'sp-fx2', sparkVals: D.fxRates[1].values, slot: 1 },
      { label: 'CAD → SGD', value: latest[2].v.toFixed(4), basis: `${deltaHtml(latest[2].v, latest[2].prev)}`, sparkId: 'sp-fx3', sparkVals: D.fxRates[2].values, slot: 2 },
      { label: 'CAD → AUD', value: latest[3].v.toFixed(4), basis: `${deltaHtml(latest[3].v, latest[3].prev)}`, sparkId: 'sp-fx4', sparkVals: D.fxRates[3].values, slot: 3 },
    ]);
    draw('fx-trend', el => C.line(el, { x: D.months, series: D.fxRates.map(r => ({ name: 'CAD→' + r.to, values: r.values })) }, { yFormat: v => v.toFixed(2), legendPosition: 'top-right' }));
    let head = '<thead><tr><th>Pair</th><th style="text-align:right;">12M avg</th><th style="text-align:right;">Min</th><th style="text-align:right;">Max</th><th style="text-align:right;">Latest</th></tr></thead>';
    let body = D.fxRates.map(r => { const avg = r.values.reduce((a, b) => a + b, 0) / r.values.length, dp = r.to === 'INR' ? 2 : 4;
      return `<tr><td class="client">CAD → ${r.to}</td><td class="n">${avg.toFixed(dp)}</td><td class="n">${Math.min(...r.values).toFixed(dp)}</td><td class="n">${Math.max(...r.values).toFixed(dp)}</td><td class="n">${r.values[LAST].toFixed(dp)}</td></tr>`; }).join('');
    document.getElementById('fx-table').innerHTML = head + '<tbody>' + body + '</tbody>';
  }

  function renderCreditNotes() {
    const rows = D.creditNotes.filter(inEnt); const total = rows.reduce((s, r) => s + r.subtotal, 0);
    setKpis('kpi-cn', [
      { label: 'Credit notes', value: money(total), basis: `${rows.length} notes`, highlight: true, sparkId: 'sp-cn1', sparkVals: rows.map(r => r.subtotal), sparkColor: EMBER() },
      { label: 'Count', value: rows.length, basis: 'ACCRECCREDIT · PAID', sparkId: 'sp-cn2', sparkVals: [rows.length], slot: 1 },
      { label: 'Largest', value: rows.length ? money(Math.max(...rows.map(r => r.subtotal))) : '—', basis: 'single note', sparkId: 'sp-cn3', sparkVals: rows.map(r => r.subtotal), slot: 2 },
      { label: 'Avg note', value: rows.length ? money(total / rows.length) : '—', basis: 'per credit note', sparkId: 'sp-cn4', sparkVals: rows.map(r => r.subtotal), slot: 3 },
    ]);
    let head = '<thead><tr><th>Entity</th><th>Date</th><th>Number</th><th>Contact</th><th>Status</th><th>Ccy</th><th style="text-align:right;">Sub total</th></tr></thead>';
    let body = rows.map(r => `<tr><td>${r.tenant}</td><td>${r.date}</td><td class="client">${r.number}</td><td>${r.contact}</td><td><span class="pill success">${r.status}</span></td><td>${r.ccy}</td><td class="n">${moneyIn(r.subtotal, r.ccy)}</td></tr>`).join('');
    document.getElementById('cn-table').innerHTML = head + '<tbody>' + body + '</tbody>' + `<tfoot><tr><td class="lbl">Total [CAD]</td><td></td><td></td><td></td><td></td><td></td><td>${moneyIn(total, 'CAD')}</td></tr></tfoot>`;
  }

  const RENDER = { home: renderHome, revenue: renderRevenue, clientrev: renderClientRev, topn: renderTopN, actpy: renderActPy,
    resource: renderResource, billability: renderBillability, billablehrs: renderBillableHrs, nonbillable: renderNonBillable,
    weekofsupply: renderWos, hoursremaining: renderHoursRemaining, backlog: renderBacklog, unassigned: renderUnassigned,
    ar: renderAR, arbytype: renderArByType, ttmar: renderTtmAr, wc: renderWC, assets: renderAssets, fxrates: renderFx, creditnotes: renderCreditNotes };

  const XF_FIELD = { home: 'entity', revenue: 'entity', clientrev: 'client', topn: 'client', actpy: 'entity', resource: 'person',
    weekofsupply: 'person', backlog: 'person', unassigned: 'project', ar: 'bucket', arbytype: 'bucket', billability: 'entity', wc: 'entity' };

  /* ---------- chart-to-chart highlighting (dim non-selected) ---------- */
  // per view: which chart containers represent each cross-filter dimension
  const HL = {
    home: { entity: ['home-revtrend', 'home-revmix'] },
    revenue: { entity: ['rev-trend'] },
    clientrev: { client: ['clientrev-chart'] },
    topn: { client: ['topn-chart'] },
    billability: { entity: ['bill-entity'] },
    wc: { entity: ['wc-entity'] },
    resource: { entity: ['res-entity'] },
    ar: { bucket: ['ar-buckets'] },
    arbytype: { bucket: ['arbytype-pie'] },
    weekofsupply: { person: ['wos-chart'] },
    backlog: { person: ['backlog-chart'] },
    unassigned: { project: ['unassigned-chart'] },
  };
  function highlightMarks(id, field, value) {
    const el = document.getElementById(id); if (!el) return;
    const full = field === 'entity' ? (D.entityByKey[value] ? D.entityByKey[value].name : value) : value;
    const shortN = field === 'entity' ? full.replace('MMR ', '') : full;
    el.querySelectorAll('svg rect, svg path').forEach(node => {
      const t = node.querySelector('title'); if (!t) return;      // skip area fills / untitled marks
      const txt = t.textContent || '';
      let cat = txt.includes(' · ') ? txt.split(' · ')[0].trim() : (txt.includes(':') ? txt.slice(0, txt.lastIndexOf(':')).trim() : txt.trim());
      const match = cat === full || cat === shortN;
      node.style.transition = 'opacity 120ms var(--ease-standard, ease)';
      node.style.opacity = match ? '1' : '0.18';
    });
  }
  function applyHighlight() {
    if (!state.xf || state.mode !== 'highlight') return;
    const map = HL[state.view]; if (!map) return;
    const ids = map[state.xf.field]; if (!ids) return;
    ids.forEach(id => highlightMarks(id, state.xf.field, state.xf.value));
  }

  function updateChrome() { const cl = state.currency; const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    set('rev-eyebrow', `Revenue · ${state.period} · ${state.cadlc === 'LC' ? 'Local currency' : cl}`);
    set('clientrev-eyebrow', `Client revenue · ${state.cadlc === 'LC' ? 'Local currency' : cl}`);
    set('topn-eyebrow', `Top clients · ${state.cadlc === 'LC' ? 'Local currency' : cl}`);
    set('actpy-eyebrow', `Actual vs prior year · ${state.period} · ${cl}`);
    set('home-eyebrow', `FY26 · Executive overview · ${cl}`); }
  function renderCurrent() { updateChrome(); renderChip(); (RENDER[state.view] || renderHome)(); applyHighlight(); }

  /* ---------- nav ---------- */
  document.querySelectorAll('.navitem[data-view]').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.navitem').forEach(n => n.classList.remove('active'));
      el.classList.add('active'); state.view = el.dataset.view; state.xf = null;
      document.querySelectorAll('.view').forEach(s => s.classList.remove('active'));
      document.getElementById('view-' + state.view).classList.add('active');
      document.getElementById('crumbLeaf').textContent = el.dataset.crumb;
      document.getElementById('canvas').scrollTop = 0; renderCurrent();
    });
  });

  /* ---------- entity filter popover ---------- */
  const entityBtn = document.getElementById('entityBtn'), entityPop = document.getElementById('entityPop');
  function buildEntityPop() {
    entityPop.innerHTML = D.entities.map(e => `<label class="opt"><input type="checkbox" data-k="${e.key}" ${state.entities.has(e.key) ? 'checked' : ''}> ${e.name}</label>`).join('') +
      `<div class="popfoot"><button class="linkbtn" id="entAll">Select all</button><button class="linkbtn" id="entNone">Clear</button></div>`;
    entityPop.querySelectorAll('input[data-k]').forEach(cb => cb.onchange = () => { state.xf = null;
      if (cb.checked) state.entities.add(cb.dataset.k); else state.entities.delete(cb.dataset.k);
      if (state.entities.size === 0) { state.entities.add(cb.dataset.k); cb.checked = true; }
      updateEntityLabel(); renderCurrent(); });
    document.getElementById('entAll').onclick = () => { state.xf = null; D.entities.forEach(e => state.entities.add(e.key)); buildEntityPop(); updateEntityLabel(); renderCurrent(); };
    document.getElementById('entNone').onclick = () => { state.xf = null; state.entities = new Set([D.entities[0].key]); buildEntityPop(); updateEntityLabel(); renderCurrent(); };
  }
  function updateEntityLabel() { const n = state.entities.size;
    document.getElementById('entityBtnLbl').textContent = n === D.entities.length ? 'All entities' : n === 1 ? D.entityByKey[[...state.entities][0]].name : n + ' entities'; }
  entityBtn.onclick = (e) => { e.stopPropagation(); entityPop.classList.toggle('open'); };
  document.addEventListener('click', (e) => { if (!entityPop.contains(e.target) && e.target !== entityBtn) entityPop.classList.remove('open'); });

  /* ---------- global controls ---------- */
  document.getElementById('currencySel').addEventListener('change', e => { state.currency = e.target.value; renderCurrent(); });
  document.getElementById('periodSel').addEventListener('change', e => { state.period = e.target.value; renderCurrent(); });
  const canvas = document.getElementById('canvas'), topbar = document.getElementById('topbar');
  canvas.addEventListener('scroll', () => topbar.classList.toggle('scrolled', canvas.scrollTop > 4));

  /* ---------- theme ---------- */
  const themeBtn = document.getElementById('themeToggle');
  function applyTheme(t) { state.theme = t; if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark'); else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('mmr-theme', t); } catch (e) {} }
  try { applyTheme(localStorage.getItem('mmr-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')); } catch (e) { applyTheme('light'); }
  themeBtn.addEventListener('click', () => { applyTheme(state.theme === 'dark' ? 'light' : 'dark'); renderCurrent(); });

  /* ---------- interaction mode toggle (Highlight / Filter) ---------- */
  const modeCtrl = document.createElement('div');
  modeCtrl.className = 'ctrl';
  modeCtrl.innerHTML = '<label>Interaction</label><select class="sel" id="modeSel"><option value="highlight">Highlight</option><option value="filter">Filter</option></select>';
  document.querySelector('.top-actions').insertBefore(modeCtrl, document.querySelector('.filterwrap'));
  document.getElementById('modeSel').addEventListener('change', e => { state.mode = e.target.value; renderCurrent(); });

  /* ---------- init ---------- */
  const sb = document.querySelector('.samplebar');
  const chipDiv = document.createElement('div'); chipDiv.id = 'xfchip'; sb.insertAdjacentElement('afterend', chipDiv);
  buildEntityPop(); updateEntityLabel(); renderCurrent();
})();
