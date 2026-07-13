(function (root) {
  'use strict';

/* ============================================================
   OpenBI · Chart engine
   Single self-executing IIFE. Exposes window.OpenBICharts.
   Dependency-free SVG.

   Loaded via:
     <script src="./openbi-charts.js"></script>

   This works from file://, http://, and https:// — unlike
   ES modules which Chrome blocks under file:// CORS.

   Reads colors via getComputedStyle from --data-* / --chart-*
   tokens in colors_and_type.css. Applies all text styling via
   the .chart-*-label / .chart-legend-* / .chart-tooltip classes
   defined in the same file — zero inline font-family, font-size,
   font-weight, or fill on <text> elements.

   Public API
   ----------
   window.OpenBICharts.donut, .stackedBar, .groupedBar, .line,
                       .area, .sparkline, .anomaly

   Each chart factory signature: (container, data, opts) -> handle
   where handle = { svg, update(newData), destroy(), _type, _plot? }

   Sort discipline (enforced in code)
   ---------------------------------
   - donut          : data sorted by value desc before render
   - stackedBar     : segments within each stack sorted desc;
                      categories sorted by total desc unless
                      opts.preserveCategoryOrder = true
   - groupedBar     : bars within each group sorted desc unless
                      opts.preserveOrder = true
   - line           : preserves x-order; only series-slot order
                      is enforced

   ============================================================ */

const SVG_NS = 'http://www.w3.org/2000/svg';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';

/* ---------- token / theme helpers ---------- */

const tok = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const isDark = () =>
  document.documentElement.getAttribute('data-theme') === 'dark';

const reducedMotion = () =>
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* The 6 categorical slots, with the Slate substitution rule for
   slot 6 in light mode (Ink Navy reads as "no data" on white). */
function slotColor(index, dark) {
  if (index < 5) return tok(`--data-${index + 1}`);
  return dark ? tok('--data-6') : tok('--data-6-slate');
}

/* Pixel value for a CSS length token, parsed from getComputedStyle. */
function tokPx(name, fallback) {
  const v = parseFloat(tok(name));
  return Number.isFinite(v) ? v : fallback;
}

/* ---------- DOM helpers ---------- */

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

function htmlEl(tag, props) {
  const el = document.createElement(tag);
  if (props) for (const k in props) {
    if (k === 'style') Object.assign(el.style, props.style);
    else if (k === 'class') el.className = props.class;
    else if (k === 'text') el.textContent = props.text;
    else el[k] = props[k];
  }
  return el;
}

function clearContainer(c) {
  while (c.firstChild) c.removeChild(c.firstChild);
}

function observeResize(container, callback) {
  let timer = 0;
  const ro = new ResizeObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(callback, 100);
  });
  ro.observe(container);
  return () => {
    ro.disconnect();
    clearTimeout(timer);
  };
}

/* ---------- formatters ---------- */

function defaultFormat(v) {
  if (v == null || !Number.isFinite(v)) return String(v);
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (abs >= 1_000_000) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (abs >= 1_000) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  /* sub-1000: pick precision based on magnitude — keeps siblings consistent */
  if (abs >= 100) return Math.round(v).toString();
  if (abs >= 10) return v.toFixed(1).replace(/\.0$/, '');
  if (abs >= 1) return v.toFixed(2).replace(/0$/, '').replace(/\.$/, '');
  return v.toFixed(2);
}

/* niceFormat — picks consistent precision for a SET of related values
   (e.g. all bars in a chart). All siblings get the same decimal count.
   Use this when rendering multiple labels that should align visually. */
function niceFormat(values, opts = {}) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return values.map(String);
  const maxAbs = Math.max(...finite.map(Math.abs));
  /* Pick decimal precision based on the largest value's magnitude */
  let suffix = '', divisor = 1;
  if (maxAbs >= 1_000_000_000) { suffix = 'B'; divisor = 1e9; }
  else if (maxAbs >= 1_000_000) { suffix = 'M'; divisor = 1e6; }
  else if (maxAbs >= 1_000) { suffix = 'k'; divisor = 1e3; }

  const scaled = finite.map((v) => v / divisor);
  const scaledMax = Math.max(...scaled.map(Math.abs));
  /* Choose decimals: enough to distinguish siblings, capped sensibly */
  let decimals;
  if (scaledMax >= 100) decimals = 0;
  else if (scaledMax >= 10) decimals = 1;
  else decimals = opts.maxDecimals ?? 2;

  return finite.map((v) => (v / divisor).toFixed(decimals) + suffix);
}

/* ---------- scales / axis ticks ---------- */

/* "Nice" tick generator — pick 5 ticks that span the data with a
   round step. Mirrors what a human would draw. */
function niceTicks(min, max, count = 5) {
  if (min === max) {
    if (min === 0) { min = 0; max = 1; }
    else { const d = Math.abs(min) * 0.1; min -= d; max += d; }
  }
  const range = max - min;
  const rough = range / (count - 1);
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const candidates = [1, 2, 2.5, 5, 10];
  let step = pow;
  for (const c of candidates) {
    if (c * pow >= rough) { step = c * pow; break; }
  }
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = niceMin; v <= niceMax + step / 2; v += step) {
    ticks.push(Math.round(v / step) * step);
  }
  return { ticks, niceMin, niceMax };
}

/* ---------- shared layout ---------- */

function plotRect(container, opts) {
  const w = container.clientWidth || opts.width || 600;
  const h = opts.height || 280;
  /* Default top padding is 16; bump to 24 when caller indicates value labels
     will render above bars/stacks (so labels aren't clipped at the top). */
  const defaultPadTop = opts.hasTopLabels ? 24 : 16;
  const padT = opts.padTop ?? tokPx('--chart-plot-pad-top', defaultPadTop);
  const padR = opts.padRight ?? tokPx('--chart-plot-pad-right', 12);
  /* padBottom 36 reserves: 8px gap from plot baseline + 12px label height
     + 16px gap from card edge. Was 28, which left labels touching the card. */
  const padB = opts.padBottom ?? tokPx('--chart-plot-pad-bottom', 36);
  const padL = opts.padLeft ?? tokPx('--chart-plot-pad-left', 40);
  return {
    w, h, padT, padR, padB, padL,
    plotX: padL,
    plotY: padT,
    plotW: Math.max(0, w - padL - padR),
    plotH: Math.max(0, h - padT - padB),
  };
}

/* ============================================================
   DONUT
   ============================================================ */

function donut(container, data, opts = {}) {
  const state = { data: data.slice() };
  let stop = null;

  function render() {
    clearContainer(container);
    const dark = isDark();
    const w = container.clientWidth || opts.width || 360;
    const legendBelow = w < 360;

    /* sort desc */
    let rows = state.data
      .map((d, i) => ({ ...d, _origIndex: i }))
      .sort((a, b) => b.value - a.value);

    /* group small slices into Other */
    const groupSmall = opts.groupSmall !== false;
    const total = rows.reduce((s, r) => s + r.value, 0);
    if (groupSmall && total > 0) {
      const cutoff = total * 0.05;
      const main = rows.filter((r) => r.value >= cutoff);
      const small = rows.filter((r) => r.value < cutoff);
      if (small.length > 1) {
        main.push({
          label: 'Other',
          value: small.reduce((s, r) => s + r.value, 0),
          _isOther: true,
        });
        rows = main;
      }
    }

    /* assign colors by descending slot order */
    rows.forEach((r, i) => {
      if (!r.color) {
        r._color = r._isOther
          ? (dark ? tok('--data-6') : tok('--data-6-slate'))
          : slotColor(i, dark);
      } else {
        r._color = r.color;
      }
    });

    /* layout: chart + legend side-by-side or stacked */
    const wrapper = htmlEl('div', {
      style: {
        display: 'flex',
        flexDirection: legendBelow ? 'column' : 'row',
        alignItems: 'center',
        gap: '20px',
        width: '100%',
        height: '100%',
      },
    });

    /* Ring fills available height (capped) so the donut card doesn't show
       a huge empty area below a fixed-size ring. The cap prevents the donut
       from becoming absurdly large in tall containers. */
    const containerH = container.clientHeight || 220;
    const maxRingByHeight = Math.max(120, containerH - 16);
    const maxRingByWidth = legendBelow ? Math.min(w - 24, 220) : Math.min(w * 0.45, 240);
    const ringSize = Math.min(maxRingByHeight, maxRingByWidth);
    const cx = ringSize / 2;
    const cy = ringSize / 2;
    const rOuter = cx - 4;
    const rInner = rOuter * 0.6;

    const svg = svgEl('svg', {
      viewBox: `0 0 ${ringSize} ${ringSize}`,
      width: ringSize,
      height: ringSize,
      role: 'img',
      'aria-label': opts.ariaLabel || `Donut chart, ${rows.length} segments, total ${defaultFormat(total)}`,
    });

    /* slices */
    let cum = 0;
    const lime = tok('--data-5');
    rows.forEach((r) => {
      const a0 = (cum / Math.max(total, 1)) * Math.PI * 2 - Math.PI / 2;
      const a1 = ((cum + r.value) / Math.max(total, 1)) * Math.PI * 2 - Math.PI / 2;
      cum += r.value;

      /* full-circle case (single 100% slice) */
      const isFull = rows.length === 1;
      const path = svgEl('path', {
        d: isFull ? fullRing(cx, cy, rOuter, rInner) : arcRingPath(cx, cy, rOuter, rInner, a0, a1),
      });
      path.setAttribute('fill', r._color);
      if (r._color.toUpperCase() === lime.toUpperCase()) {
        path.setAttribute('stroke', tok('--data-5-border'));
        path.setAttribute('stroke-width', '0.5');
      }
      const ttl = svgEl('title');
      ttl.textContent = `${r.label}: ${defaultFormat(r.value)}`;
      path.appendChild(ttl);
      svg.appendChild(path);
    });

    /* center total */
    const totalText = svgEl('text', {
      x: cx,
      y: cy,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      class: 'chart-total-label',
    });
    totalText.textContent = opts.totalFormatter
      ? opts.totalFormatter(total)
      : defaultFormat(total);
    svg.appendChild(totalText);

    wrapper.appendChild(svg);

    /* legend */
    const legend = htmlEl('div', {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: tok('--chart-legend-gap-row') || '6px',
        minWidth: legendBelow ? '0' : '160px',
        flex: legendBelow ? '0 0 auto' : '1 1 auto',
      },
    });

    rows.forEach((r) => {
      const row = htmlEl('div', {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px',
        },
      });
      const left = htmlEl('span', {
        style: { display: 'inline-flex', alignItems: 'center', gap: '8px' },
      });
      const swatch = htmlEl('span', {
        style: {
          display: 'inline-block',
          width: tok('--chart-legend-swatch') || '10px',
          height: tok('--chart-legend-swatch') || '10px',
          borderRadius: '2px',
          background: r._color,
          flex: '0 0 auto',
        },
      });
      const label = htmlEl('span', { class: 'chart-legend-text', text: r.label });
      left.appendChild(swatch);
      left.appendChild(label);

      const val = htmlEl('span', {
        class: 'chart-legend-value',
        text: opts.valueFormatter ? opts.valueFormatter(r.value) : defaultFormat(r.value),
      });

      row.appendChild(left);
      row.appendChild(val);
      legend.appendChild(row);
    });

    wrapper.appendChild(legend);
    container.appendChild(wrapper);
  }

  render();
  stop = observeResize(container, render);

  return {
    _type: 'donut',
    get svg() { return container.querySelector('svg'); },
    update(next) { state.data = next.slice(); render(); },
    destroy() { if (stop) stop(); clearContainer(container); },
  };
}

/* arc ring path: outer arc, then inner arc back, closed */
function arcRingPath(cx, cy, rO, rI, a0, a1) {
  const x0 = cx + rO * Math.cos(a0);
  const y0 = cy + rO * Math.sin(a0);
  const x1 = cx + rO * Math.cos(a1);
  const y1 = cy + rO * Math.sin(a1);
  const x2 = cx + rI * Math.cos(a1);
  const y2 = cy + rI * Math.sin(a1);
  const x3 = cx + rI * Math.cos(a0);
  const y3 = cy + rI * Math.sin(a0);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return [
    `M ${x0} ${y0}`,
    `A ${rO} ${rO} 0 ${large} 1 ${x1} ${y1}`,
    `L ${x2} ${y2}`,
    `A ${rI} ${rI} 0 ${large} 0 ${x3} ${y3}`,
    'Z',
  ].join(' ');
}

function fullRing(cx, cy, rO, rI) {
  /* two semi-arcs to draw a full ring (single 100% slice) */
  return [
    `M ${cx - rO} ${cy}`,
    `A ${rO} ${rO} 0 1 1 ${cx + rO} ${cy}`,
    `A ${rO} ${rO} 0 1 1 ${cx - rO} ${cy}`,
    `M ${cx - rI} ${cy}`,
    `A ${rI} ${rI} 0 1 0 ${cx + rI} ${cy}`,
    `A ${rI} ${rI} 0 1 0 ${cx - rI} ${cy}`,
    'Z',
  ].join(' ');
}

/* ============================================================
   BAR CHARTS — stackedBar / groupedBar share core
   ============================================================ */

function barChart(container, data, opts, mode) {
  const state = { data: cloneBarData(data) };
  let stop = null;

  function render() {
    clearContainer(container);
    const dark = isDark();
    /* Bars show value labels above (totals for stacks, per-bar values for grouped) */
    const wantsLabels = opts.showTotals !== false && opts.showValues !== false;
    const { w, h, plotX, plotY, plotW, plotH } = plotRect(container, { ...opts, hasTopLabels: wantsLabels });

    const cats = state.data.categories.slice();
    const series = state.data.series.map((s) => ({
      name: s.name,
      values: s.values.slice(),
      color: s.color,
    }));

    /* compute per-category metric used for sorting + scale */
    const catTotals = cats.map((_, i) =>
      mode === 'stacked'
        ? series.reduce((sum, s) => sum + (s.values[i] || 0), 0)
        : Math.max(0, ...series.map((s) => s.values[i] || 0)),
    );

    /* sort categories by total desc unless preserveCategoryOrder */
    let order = cats.map((_, i) => i);
    if (!opts.preserveCategoryOrder) {
      order.sort((a, b) => catTotals[b] - catTotals[a]);
    }
    const orderedCats = order.map((i) => cats[i]);
    const orderedTotals = order.map((i) => catTotals[i]);
    const orderedValues = series.map((s) => order.map((i) => s.values[i] || 0));

    /* y scale: max of stack totals (stacked) or max single value (grouped) */
    const yMax = mode === 'stacked'
      ? Math.max(1, ...orderedTotals)
      : Math.max(1, ...orderedValues.flat());
    const { ticks: yTicks, niceMax } = niceTicks(0, yMax, 5);
    const yScale = (v) => plotY + plotH - (v / niceMax) * plotH;

    /* x scale: equal-width category slots */
    const slotW = plotW / orderedCats.length;
    const gapBetween = tokPx('--chart-bar-gap-between', 16);
    const gapWithin = tokPx('--chart-bar-gap-within', 4);
    const radius = tokPx('--chart-bar-radius', 2);

    /* Legend goes BEFORE the SVG when positioned top-* (default top-right).
       This places it above the plot so the chart can use the full container
       height. Caller can opt for legend at the bottom via opts.legendPosition. */
    const legendPos = opts.legendPosition || 'top-right';
    const legendOnTop = legendPos.startsWith('top');
    const seriesColors = series.map((s, i) => s.color || slotColor(i, dark));
    if (series.length > 1 && legendOnTop) {
      container.appendChild(makeLegend(series, seriesColors, { position: legendPos }));
    }

    /* The chart SVG fills the remaining height of its container. */
    const svg = svgEl('svg', {
      viewBox: `0 0 ${w} ${h}`,
      width: '100%',
      height: h,
      role: 'img',
      'aria-label': opts.ariaLabel || `${mode} bar chart, ${orderedCats.length} categories, ${series.length} series`,
      style: 'overflow: visible;',
    });

    /* gridlines + y tick labels (consistent precision via niceFormat).
       The bottom-most tick is rendered as a dedicated axis baseline (stronger
       stroke + --chart-axis token) so it reads as the axis, not just another
       gridline blending with the rest. */
    const gridColor = tok('--chart-grid');
    const axisColor = tok('--chart-axis');
    const gGrid = svgEl('g', { 'aria-hidden': 'true' });
    const yTickLabels = niceFormat(yTicks);
    const baselineY = yScale(0);
    yTicks.forEach((tv, ti) => {
      const y = yScale(tv);
      const isBaseline = Math.abs(y - baselineY) < 0.5;
      gGrid.appendChild(svgEl('line', {
        x1: plotX, x2: plotX + plotW, y1: y, y2: y,
        stroke: isBaseline ? axisColor : gridColor,
        'stroke-width': isBaseline ? '1.25' : '1',
      }));
      const t = svgEl('text', {
        x: plotX - 6,
        y: y,
        'text-anchor': 'end',
        'dominant-baseline': 'central',
        class: 'chart-axis-label',
      });
      t.textContent = yTickLabels[ti];
      gGrid.appendChild(t);
    });
    svg.appendChild(gGrid);

    /* bars + totals (consistent precision via niceFormat across all totals/values) */
    const lime = tok('--data-5');

    /* Pre-format ALL labels that will appear with consistent precision so
       siblings line up (e.g. 30.8 / 30.7 / 30.0 / 29.2, never mixed). */
    const allLabelValues = mode === 'stacked'
      ? orderedTotals
      : orderedCats.flatMap((_, ci) => series.map((s, si) => orderedValues[si][ci]));
    const labelMap = new Map();
    const formatted = opts.valueFormatter
      ? allLabelValues.map((v) => opts.valueFormatter(v))
      : niceFormat(allLabelValues);
    allLabelValues.forEach((v, i) => labelMap.set(v + '_' + i, formatted[i]));
    let labelIdx = 0;

    orderedCats.forEach((cat, ci) => {
      const slotCenterX = plotX + slotW * ci + slotW / 2;
      const colTotal = orderedTotals[ci];

      if (mode === 'stacked') {
        /* sort segments within this stack desc */
        const segments = series
          .map((s, si) => ({ name: s.name, value: orderedValues[si][ci], color: seriesColors[si], si }))
          .filter((seg) => seg.value > 0)
          .sort((a, b) => b.value - a.value);

        const barW = Math.max(8, slotW - gapBetween);
        let yCursor = yScale(0);
        segments.forEach((seg, idx) => {
          const segH = (seg.value / niceMax) * plotH;
          const yTop = yCursor - segH;
          const isTop = idx === segments.length - 1;
          const r = isTop ? radius : 0;
          const rect = svgEl('rect', {
            x: slotCenterX - barW / 2,
            y: yTop,
            width: barW,
            height: segH,
            rx: r,
            ry: r,
          });
          rect.setAttribute('fill', seg.color);
          if (seg.color.toUpperCase() === lime.toUpperCase()) {
            rect.setAttribute('stroke', tok('--data-5-border'));
            rect.setAttribute('stroke-width', '0.5');
          }
          const ttl = svgEl('title');
          ttl.textContent = `${cat} · ${seg.name}: ${defaultFormat(seg.value)}`;
          rect.appendChild(ttl);
          svg.appendChild(rect);
          yCursor = yTop;
        });

        /* total label above the stack — consistent precision via labelMap */
        if (colTotal > 0 && opts.showTotals !== false) {
          const tt = svgEl('text', {
            x: slotCenterX,
            y: yScale(colTotal) - 6,
            'text-anchor': 'middle',
            class: 'chart-total-label',
          });
          tt.textContent = labelMap.get(colTotal + '_' + labelIdx);
          labelIdx++;
          svg.appendChild(tt);
        }
      } else {
        /* grouped: sort bars within group desc */
        const bars = series
          .map((s, si) => ({ name: s.name, value: orderedValues[si][ci], color: seriesColors[si] }))
          .sort((a, b) => opts.preserveOrder ? 0 : b.value - a.value);

        const groupW = Math.max(8, slotW - gapBetween);
        const barW = Math.max(2, (groupW - gapWithin * (bars.length - 1)) / bars.length);
        const startX = slotCenterX - groupW / 2;

        bars.forEach((bar, bi) => {
          const x = startX + bi * (barW + gapWithin);
          const y = yScale(bar.value);
          const barH = yScale(0) - y;
          const rect = svgEl('rect', {
            x, y, width: barW, height: barH, rx: radius, ry: radius,
          });
          rect.setAttribute('fill', bar.color);
          if (bar.color.toUpperCase() === lime.toUpperCase()) {
            rect.setAttribute('stroke', tok('--data-5-border'));
            rect.setAttribute('stroke-width', '0.5');
          }
          const ttl = svgEl('title');
          ttl.textContent = `${cat} · ${bar.name}: ${defaultFormat(bar.value)}`;
          rect.appendChild(ttl);
          svg.appendChild(rect);

          /* value label above each grouped bar — consistent precision */
          if (opts.showValues !== false && bar.value > 0) {
            const vt = svgEl('text', {
              x: x + barW / 2,
              y: y - 4,
              'text-anchor': 'middle',
              class: 'chart-total-label',
            });
            const vIdx = ci * series.length + bi;
            vt.textContent = labelMap.get(bar.value + '_' + vIdx) || defaultFormat(bar.value);
            svg.appendChild(vt);
          }
        });
      }
    });

    /* x-axis labels (with rotation if needed) */
    const xLabelGroup = svgEl('g');
    const slotW_px = plotW / orderedCats.length;
    /* measure widest label by character count heuristic — 7px per char at 10px JBM */
    const maxChars = Math.max(...orderedCats.map((c) => String(c).length));
    const approxLabelW = maxChars * 7;
    const rotate = approxLabelW > slotW_px * 1.1;

    orderedCats.forEach((cat, ci) => {
      const x = plotX + slotW_px * ci + slotW_px / 2;
      const y = plotY + plotH + (rotate ? 14 : 18);
      const t = svgEl('text', {
        x, y,
        'text-anchor': rotate ? 'end' : 'middle',
        class: 'chart-axis-label',
      });
      if (rotate) t.setAttribute('transform', `rotate(-30 ${x} ${y})`);
      t.textContent = String(cat);
      xLabelGroup.appendChild(t);
    });
    svg.appendChild(xLabelGroup);

    container.appendChild(svg);

    /* legend at bottom only if explicitly requested */
    if (series.length > 1 && !legendOnTop) {
      container.appendChild(makeLegend(series, seriesColors, { position: legendPos }));
    }
  }

  render();
  stop = observeResize(container, render);

  return {
    _type: mode === 'stacked' ? 'stackedBar' : 'groupedBar',
    get svg() { return container.querySelector('svg'); },
    update(next) { state.data = cloneBarData(next); render(); },
    destroy() { if (stop) stop(); clearContainer(container); },
  };
}

function cloneBarData(d) {
  return {
    categories: d.categories.slice(),
    series: d.series.map((s) => ({ name: s.name, values: s.values.slice(), color: s.color })),
  };
}

function makeLegend(series, colors, opts = {}) {
  const position = opts.position || 'top-right';
  const wrap = htmlEl('div', {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      justifyContent: position === 'top-right' || position === 'bottom-right'
        ? 'flex-end'
        : (position === 'top-left' || position === 'bottom-left' ? 'flex-start' : 'center'),
      gap: tok('--chart-legend-gap-col') || '16px',
      rowGap: tok('--chart-legend-gap-row') || '6px',
      marginTop: position.startsWith('bottom') ? '12px' : '0',
      marginBottom: position.startsWith('top') ? '8px' : '0',
    },
  });
  series.forEach((s, i) => {
    const row = htmlEl('span', {
      style: { display: 'inline-flex', alignItems: 'center', gap: '8px' },
    });
    row.appendChild(htmlEl('span', {
      style: {
        display: 'inline-block',
        width: tok('--chart-legend-swatch') || '10px',
        height: tok('--chart-legend-swatch') || '10px',
        borderRadius: '2px',
        background: colors[i],
        flex: '0 0 auto',
      },
    }));
    row.appendChild(htmlEl('span', { class: 'chart-legend-text', text: s.name }));
    wrap.appendChild(row);
  });
  return wrap;
}

/* addLabelPill — wraps an SVG <text> element with a translucent
   rounded-rect background so the label stays legible against any
   chart background (lines, bars, gradients). Returns a <g> containing
   both the rect and the text. Caller must append the returned group
   AFTER all chart geometry so the pill renders on top.

   Usage:
     const text = svgEl('text', { x, y, ... });
     text.textContent = 'Q1 dip';
     svg.appendChild(addLabelPill(text, { theme: dark ? 'dark' : 'light' }));
*/
function addLabelPill(textEl, opts = {}) {
  const padX = opts.padX ?? 5;
  const padY = opts.padY ?? 2;
  const dark = opts.theme === 'dark';
  const g = svgEl('g');
  const rect = svgEl('rect', {
    rx: 3, ry: 3,
    fill: dark ? 'rgba(15, 23, 42, 0.85)' : 'rgba(255, 255, 255, 0.88)',
    'data-pill': 'true',
  });
  g.appendChild(rect);
  g.appendChild(textEl);

  /* Defer measurement to next frame after attach so getBBox works */
  requestAnimationFrame(() => {
    if (!textEl.isConnected) return;
    try {
      const bb = textEl.getBBox();
      rect.setAttribute('x', bb.x - padX);
      rect.setAttribute('y', bb.y - padY);
      rect.setAttribute('width', bb.width + padX * 2);
      rect.setAttribute('height', bb.height + padY * 2);
    } catch (e) { /* getBBox can fail on detached nodes */ }
  });
  return g;
}

function stackedBar(container, data, opts = {}) {
  return barChart(container, data, opts, 'stacked');
}

function groupedBar(container, data, opts = {}) {
  return barChart(container, data, opts, 'grouped');
}

/* ============================================================
   LINE / AREA
   ============================================================ */

function line(container, data, opts = {}) {
  const state = { data: cloneLineData(data) };
  const overlays = [];
  let stop = null;
  let plotInfo = null;
  let handle = null;

  function render() {
    clearContainer(container);
    const dark = isDark();
    const { w, h, plotX, plotY, plotW, plotH } = plotRect(container, opts);

    const xs = state.data.x.slice();
    const series = state.data.series.map((s) => ({
      name: s.name,
      values: s.values.slice(),
      color: s.color,
      dashed: s.dashed,
    }));

    const isSingle = series.length === 1;
    const drawArea = isSingle && opts.area !== false;

    /* y range — when all values are positive AND well above zero, hug the
       data so the chart doesn't waste plot height anchoring at 0. Override
       with opts.yZero = true to force 0-anchored axis. */
    const allVals = series.flatMap((s) => s.values).filter((v) => Number.isFinite(v));
    const dataMin = Math.min(...allVals);
    const dataMax = Math.max(...allVals);
    const dataRange = dataMax - dataMin;
    /* Anchor at 0 if explicitly requested OR if dataMin is within 25% of 0
       (i.e. zero is naturally close to the data — keeps the visual honest). */
    const shouldAnchorZero = opts.yZero === true ||
      (dataMin >= 0 && dataMin < dataRange * 0.25);
    const yMin = shouldAnchorZero ? Math.min(0, dataMin) : dataMin;
    const yMax = Math.max(yMin + 1, dataMax);
    const { ticks: yTicks, niceMin, niceMax } = niceTicks(yMin, yMax, 5);
    const yScale = (v) => plotY + plotH - ((v - niceMin) / (niceMax - niceMin)) * plotH;
    const xScale = (i) => xs.length === 1
      ? plotX + plotW / 2
      : plotX + (i / (xs.length - 1)) * plotW;

    plotInfo = { plotX, plotY, plotW, plotH, niceMin, niceMax, xCount: xs.length, xScale, yScale };

    const seriesColors = series.map((s, i) => s.color || slotColor(i, dark));
    /* lime swap for line strokes/fills — Lime on white disappears,
       so use the slightly darker border token for legibility. */
    const lime = tok('--data-5');
    const limeBorder = tok('--data-5-border');
    const strokeColors = seriesColors.map((c) =>
      (!dark && c.toUpperCase() === lime.toUpperCase()) ? limeBorder : c
    );

    /* Legend goes BEFORE the SVG when positioned top-* (default top-right
       for multi-series). Single-series gets no legend. >4 series defaults
       to 'bottom' to give each label horizontal room. */
    const legendPos = opts.legendPosition
      || (series.length > 4 ? 'bottom' : 'top-right');
    const legendOnTop = legendPos.startsWith('top');
    if (series.length > 1 && legendOnTop) {
      container.appendChild(makeLegend(series, strokeColors, { position: legendPos }));
    }

    const svg = svgEl('svg', {
      viewBox: `0 0 ${w} ${h}`,
      width: '100%',
      height: h,
      role: 'img',
      'aria-label': opts.ariaLabel || `Line chart, ${series.length} series, ${xs.length} points`,
      style: 'overflow: visible;',
    });

    /* gridlines + y tick labels (consistent precision via niceFormat).
       The bottom-most tick is rendered as a dedicated axis baseline (stronger
       stroke + --chart-axis token) so it reads as the axis, not just another
       gridline blending with the rest. */
    const grid = svgEl('g', { 'aria-hidden': 'true' });
    const yTickLabels = niceFormat(yTicks);
    const gridColor = tok('--chart-grid');
    const axisColor = tok('--chart-axis');
    const baselineY = plotY + plotH;
    yTicks.forEach((tv, ti) => {
      const y = yScale(tv);
      const isBaseline = Math.abs(y - baselineY) < 0.5;
      grid.appendChild(svgEl('line', {
        x1: plotX, x2: plotX + plotW, y1: y, y2: y,
        stroke: isBaseline ? axisColor : gridColor,
        'stroke-width': isBaseline ? '1.25' : '1',
      }));
      const t = svgEl('text', {
        x: plotX - 6, y,
        'text-anchor': 'end', 'dominant-baseline': 'central',
        class: 'chart-axis-label',
      });
      t.textContent = yTickLabels[ti];
      grid.appendChild(t);
    });
    /* If the lowest tick isn't exactly at plotY+plotH (line chart with
       non-zero-anchored ticks), draw an explicit axis line at the plot
       bottom so the chart still has a clear baseline. */
    const lowestTickY = Math.min(...yTicks.map(yScale));
    const highestTickY = Math.max(...yTicks.map(yScale));
    if (Math.abs(highestTickY - baselineY) > 0.5) {
      grid.appendChild(svgEl('line', {
        x1: plotX, x2: plotX + plotW, y1: baselineY, y2: baselineY,
        stroke: axisColor, 'stroke-width': '1.25',
      }));
    }
    svg.appendChild(grid);

    /* x labels — show first, last, plus evenly spaced subset (≤7 total) */
    const xLabelStep = Math.max(1, Math.ceil(xs.length / 7));
    xs.forEach((xv, i) => {
      if (i === 0 || i === xs.length - 1 || i % xLabelStep === 0) {
        const t = svgEl('text', {
          x: xScale(i),
          y: plotY + plotH + 18,
          'text-anchor': 'middle',
          class: 'chart-axis-label',
        });
        t.textContent = String(xv);
        svg.appendChild(t);
      }
    });

    /* area fill (single-series only) */
    if (drawArea) {
      const gid = `og_${Math.random().toString(36).slice(2, 9)}`;
      const defs = svgEl('defs');
      const grad = svgEl('linearGradient', { id: gid, x1: '0', x2: '0', y1: '0', y2: '1' });
      const stop1 = svgEl('stop', { offset: '0', 'stop-color': strokeColors[0], 'stop-opacity': '0.22' });
      const stop2 = svgEl('stop', { offset: '1', 'stop-color': strokeColors[0], 'stop-opacity': '0' });
      grad.appendChild(stop1); grad.appendChild(stop2);
      defs.appendChild(grad);
      svg.appendChild(defs);

      const vals = series[0].values;
      const pts = vals.map((v, i) => `${xScale(i)},${yScale(v)}`);
      const baseY = yScale(Math.max(niceMin, 0));
      const areaPath = svgEl('path', {
        d: `M ${xScale(0)},${baseY} L ${pts.join(' L ')} L ${xScale(vals.length - 1)},${baseY} Z`,
      });
      areaPath.setAttribute('fill', `url(#${gid})`);
      svg.appendChild(areaPath);
    }

    /* lines */
    series.forEach((s, si) => {
      const pts = s.values.map((v, i) => `${xScale(i)},${yScale(v)}`).join(' L ');
      const path = svgEl('path', {
        d: `M ${pts}`,
        'stroke-width': isSingle ? '2.5' : '1.75',
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
        fill: 'none',
      });
      path.setAttribute('stroke', strokeColors[si]);
      if (s.dashed) path.setAttribute('stroke-dasharray', '6 4');
      const ttl = svgEl('title');
      ttl.textContent = s.name;
      path.appendChild(ttl);
      svg.appendChild(path);
    });

    container.appendChild(svg);

    /* legend at bottom only if explicitly requested */
    if (series.length > 1 && !legendOnTop) {
      container.appendChild(makeLegend(series, strokeColors, { position: legendPos }));
    }

    /* re-apply registered overlays (anomaly markers etc.) */
    overlays.forEach((fn) => { try { fn(handle); } catch (e) { /* ignore */ } });
  }

  render();
  stop = observeResize(container, render);

  handle = {
    _type: 'line',
    _overlays: overlays,
    get svg() { return container.querySelector('svg'); },
    get _plot() { return plotInfo; },
    update(next) { state.data = cloneLineData(next); render(); },
    destroy() { if (stop) stop(); clearContainer(container); overlays.length = 0; },
  };
  return handle;
}

function cloneLineData(d) {
  return {
    x: d.x.slice(),
    series: d.series.map((s) => ({
      name: s.name, values: s.values.slice(), color: s.color, dashed: s.dashed,
    })),
  };
}

/* area is line with a single series and an explicit area fill (default
   already applies for single-series line; this is just a named alias). */
function area(container, data, opts = {}) {
  return line(container, data, { ...opts, area: true });
}

/* ============================================================
   SPARKLINE
   ============================================================ */

function sparkline(container, values, opts = {}) {
  const state = { values: values.slice() };
  let stop = null;

  function render() {
    clearContainer(container);
    const dark = isDark();
    const slot = (opts.slot || 1) - 1;
    const color = opts.color || slotColor(slot, dark);
    const vals = state.values;
    if (vals.length === 0) return;

    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1;
    const W = 100, H = 36;
    const xs = vals.map((_, i) => (i / Math.max(vals.length - 1, 1)) * W);
    const ys = vals.map((v) => H - ((v - min) / range) * H);

    const gid = `sp_${Math.random().toString(36).slice(2, 9)}`;
    const svg = svgEl('svg', {
      viewBox: `0 0 ${W} ${H}`,
      width: '100%',
      height: opts.height || H,
      preserveAspectRatio: 'none',
      role: 'img',
      'aria-label': opts.ariaLabel || `Sparkline trend, ${vals.length} points`,
    });
    const defs = svgEl('defs');
    const grad = svgEl('linearGradient', { id: gid, x1: '0', x2: '0', y1: '0', y2: '1' });
    const s0 = svgEl('stop', { offset: '0', 'stop-color': color, 'stop-opacity': '0.25' });
    const s1 = svgEl('stop', { offset: '1', 'stop-color': color, 'stop-opacity': '0' });
    grad.appendChild(s0); grad.appendChild(s1);
    defs.appendChild(grad);
    svg.appendChild(defs);

    const pts = xs.map((x, i) => `${x},${ys[i]}`);
    const areaPath = svgEl('path', {
      d: `M 0,${H} L ${pts.join(' L ')} L ${W},${H} Z`,
    });
    areaPath.setAttribute('fill', `url(#${gid})`);
    svg.appendChild(areaPath);

    const linePath = svgEl('path', {
      d: `M ${pts.join(' L ')}`,
      'stroke-width': '1.5',
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
      fill: 'none',
    });
    linePath.setAttribute('stroke', color);
    svg.appendChild(linePath);

    container.appendChild(svg);
  }

  render();
  stop = observeResize(container, render);

  return {
    _type: 'sparkline',
    get svg() { return container.querySelector('svg'); },
    update(next) { state.values = next.slice(); render(); },
    destroy() { if (stop) stop(); clearContainer(container); },
  };
}

/* ============================================================
   ANOMALY OVERLAY
   Works on line charts (uses chartReturn._plot).
   For other chart types, no-op with a console warning.
   ============================================================ */

function anomaly(chartReturn, { xValue, yValue, label, position } = {}) {
  if (!chartReturn || chartReturn._type !== 'line') {
    if (typeof console !== 'undefined') {
      console.warn('[openbi-charts] anomaly() v1 supports line charts only.');
    }
    return null;
  }

  function apply(handle) {
    const svg = handle && handle.svg;
    const plot = handle && handle._plot;
    if (!svg || !plot) return null;
    const { plotX, plotY, plotW, plotH, xCount, yScale, niceMin, niceMax } = plot;

    /* xValue is a 0-based index into the original x array */
    const cx = xCount === 1 ? plotX + plotW / 2 : plotX + (xValue / (xCount - 1)) * plotW;
    const cy = yScale(Math.min(Math.max(yValue, niceMin), niceMax));

    const halo = svgEl('circle', { cx, cy, r: 14 });
    halo.setAttribute('fill', tok('--chart-anomaly-halo'));
    svg.appendChild(halo);

    const dot = svgEl('circle', { cx, cy, r: 6 });
    dot.setAttribute('fill', tok('--chart-anomaly-dot'));
    svg.appendChild(dot);

    if (label) {
      const vb = svg.viewBox.baseVal;
      let pos = position;
      if (!pos) {
        /* Auto-pick: prefer above the dot if there's room, otherwise below.
           This avoids most line collisions because the dot itself sits on
           the data line and "above" is usually open space. */
        pos = (cy - plotY) > 28 ? 'top-right' : 'bottom-right';
      }
      /* Estimate label width (pill + padding) and flip if it would overflow.
         Roughly 7px per character at 11px chart-anomaly-label font. */
      const estLabelW = (label.length * 7) + 24;
      if (cx + estLabelW > vb.width) pos = pos.replace('right', 'left');

      const dx = pos.includes('right') ? 12 : -12;
      const dy = pos.includes('bottom') ? 18 : -12;
      const anchor = pos.includes('right') ? 'start' : 'end';

      const t = svgEl('text', {
        x: cx + dx, y: cy + dy,
        'text-anchor': anchor,
        'dominant-baseline': 'middle',
        class: 'chart-anomaly-label',
      });
      t.textContent = label;
      /* Wrap in a legibility pill so the label reads against any background
         (line crossings, gradients, dense plots). */
      svg.appendChild(addLabelPill(t, { theme: isDark() ? 'dark' : 'light' }));
    }
    return { halo, dot };
  }

  /* Register so the overlay survives ResizeObserver re-renders, and
     also apply once now for immediate visibility. */
  if (Array.isArray(chartReturn._overlays)) {
    chartReturn._overlays.push(apply);
  }
  return apply(chartReturn);
}


  /* Public API — exposed on window.OpenBICharts for non-module loading.
     Also assigned to globalThis for environments that prefer that. */
  const api = { donut, stackedBar, groupedBar, line, area, sparkline, anomaly };
  if (typeof root !== 'undefined') {
    root.OpenBICharts = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
