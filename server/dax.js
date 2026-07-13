/* ============================================================
   DAX queries + shape mapper for MMR Newsletter Analytics.
   Each query runs against the live semantic model via the Power BI
   executeQueries REST API; the mapper turns results into the exact
   window.MMR shape the front-end consumes.

   IMPORTANT — validate against YOUR model before production:
   Measure / table / column names below are taken from the published
   "MMR - Newsletter Analytics" model. Confirm each one resolves
   (Power BI Desktop > run the EVALUATE in DAX query view). Any query
   that errors is caught per-field and that slice falls back to the
   bundled sample so the app never goes blank — check server logs for
   "[dax] <field> fell back to sample".

   Units: revenue / AR / balance-sheet measures return ABSOLUTE amounts;
   the app expects CAD millions, so the mapper divides by 1e6. Billability
   returns a 0–1 fraction. FTE returns a count.
   ============================================================ */

// Department dimension value  ->  app entity key
const DEPT_TO_KEY = {
  'MMR CANADA': 'canada', 'MMR USA': 'usa', 'MMR INDIA': 'india',
  'MMR SINGAPORE': 'singapore', 'MMR AUSTRALIA': 'australia',
};

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtMonth(d) { const dt = new Date(d); if (isNaN(dt)) return null; return `${MONTH_ABBR[dt.getUTCMonth()]} '${String(dt.getUTCFullYear()).slice(2)}`; }

/* ---- DAX query strings (trailing window handled by the model's own dates) ---- */
const Q = {
  // month × department revenue (CAD), monthly base (SelectedCalc defaults to 1 = base month)
  revByMonthDept: `
EVALUATE
SUMMARIZECOLUMNS(
    'Date Table'[Month End],
    'DIM_Department Name'[Department],
    "Rev", [FX_PNL_CAD_TI]
)
ORDER BY 'Date Table'[Month End] ASC`,

  // month × department prior-year revenue (CAD)
  pyByMonthDept: `
EVALUATE
SUMMARIZECOLUMNS(
    'Date Table'[Month End],
    'DIM_Department Name'[Department],
    "PY", CALCULATE([FX_PNL_CAD], SAMEPERIODLASTYEAR('Date Table'[Date]))
)
ORDER BY 'Date Table'[Month End] ASC`,

  fteByMonth: `EVALUATE SUMMARIZECOLUMNS('Date Table'[Month End], "FTE", [KPI_FTE_Adj]) ORDER BY 'Date Table'[Month End] ASC`,
  billByMonth: `EVALUATE SUMMARIZECOLUMNS('Date Table'[Month End], "Bill", [Billability Percent_Avg]) ORDER BY 'Date Table'[Month End] ASC`,

  // balance sheet metrics by month (absolute CAD)
  bsByMonth: `
EVALUATE
SUMMARIZECOLUMNS(
    'Date Table'[Month End],
    "Cash", [1060_Total Cash and Cash Equivalents],
    "CA", [1500_Total Current Assets Metrics],
    "CL", [2500_Total current liabilities-metrics],
    "Equity", [3600_Total Equity]
)
ORDER BY 'Date Table'[Month End] ASC`,
};

/* ---- helpers to read executeQueries rows ----
   executeQueries returns column keys as they appear in the result, e.g.
   "Date Table[Month End]" (table name, no quotes) and "[Rev]" for inline measures.
   Match on the bracketed segment so quotes/table-name differences don't matter. */
function col(row, ...names) {
  for (const n of names) { if (n in row) return row[n]; }         // exact key
  const keys = Object.keys(row);
  for (const n of names) {
    const bracket = n.indexOf('[') >= 0 ? n.slice(n.indexOf('[')) : '[' + n + ']'; // "[Month End]"
    const hit = keys.find(k => k === n || k.endsWith(bracket));
    if (hit) return row[hit];
  }
  return undefined;
}

/**
 * Build the full window.MMR shape.
 * @param {(dax:string)=>Promise<Array<object>>} runQuery  executes one EVALUATE, returns rows
 * @param {object} sample  the bundled sample shape (fallback per field)
 */
async function buildShape(runQuery, sample) {
  const out = JSON.parse(JSON.stringify(sample));   // deep clone: everything falls back to sample
  const liveFields = [], failed = [];
  const tryField = async (name, fn) => { try { await fn(); liveFields.push(name); }
    catch (e) { failed.push(name); console.error(`[dax] ${name} fell back to sample:`, e.message); } };

  // 1) months + revenue by entity  (drives most of the app)
  let months = null;
  await tryField('revenue', async () => {
    const rows = await runQuery(Q.revByMonthDept);
    const monthSet = [...new Set(rows.map(r => col(r, "'Date Table'[Month End]", 'Month End')))].filter(m => m != null && !isNaN(new Date(m))).sort((a, b) => new Date(a) - new Date(b));
    const last12 = monthSet.slice(-12);
    months = last12;
    out.months = last12.map(fmtMonth);
    out.entities.forEach(e => { e.rev = last12.map(() => 0); });
    const byKey = Object.fromEntries(out.entities.map(e => [e.key, e]));
    rows.forEach(r => {
      const m = col(r, "'Date Table'[Month End]", 'Month End'); const idx = last12.indexOf(m); if (idx < 0) return;
      const key = DEPT_TO_KEY[col(r, "'DIM_Department Name'[Department]", 'Department')]; if (!key || !byKey[key]) return;
      byKey[key].rev[idx] += (Number(col(r, '[Rev]', 'Rev')) || 0) / 1e6;
    });
  });

  const alignMonthly = async (name, dax, valNames, assign) => {
    await tryField(name, async () => {
      if (!months) throw new Error('no month axis');
      const rows = await runQuery(dax);
      const map = {}; rows.forEach(r => { map[col(r, "'Date Table'[Month End]", 'Month End')] = r; });
      assign(months.map(m => map[m]));
    });
  };

  // 2) prior-year → per-entity blended pyF (PY / current over the window)
  await tryField('priorYear', async () => {
    if (!months) throw new Error('no month axis');
    const rows = await runQuery(Q.pyByMonthDept);
    const pySum = {}; rows.forEach(r => { const key = DEPT_TO_KEY[col(r, "'DIM_Department Name'[Department]", 'Department')]; if (!key) return;
      const m = col(r, "'Date Table'[Month End]", 'Month End'); if (months.indexOf(m) < 0) return;
      pySum[key] = (pySum[key] || 0) + (Number(col(r, '[PY]', 'PY')) || 0) / 1e6; });
    out.entities.forEach(e => { const cur = e.rev.reduce((a, b) => a + b, 0); if (cur > 0 && pySum[e.key]) e.pyF = +(pySum[e.key] / cur).toFixed(3); });
  });

  // 3) FTE, billability
  await alignMonthly('fte', Q.fteByMonth, ['[FTE]', 'FTE'], (r) => { out.fte = r.map(x => Math.round(Number(col(x || {}, '[FTE]', 'FTE')) || 0)); });
  await alignMonthly('billability', Q.billByMonth, ['[Bill]', 'Bill'], (r) => { out.billability = r.map(x => +(Number(col(x || {}, '[Bill]', 'Bill')) || 0).toFixed(3)); });

  // 4) balance sheet (cash / current assets / current liabilities / equity)
  await tryField('balanceSheet', async () => {
    if (!months) throw new Error('no month axis');
    const rows = await runQuery(Q.bsByMonth); const map = {}; rows.forEach(r => { map[col(r, "'Date Table'[Month End]", 'Month End')] = r; });
    const pick = (r, k) => (Number(col(r || {}, '[' + k + ']', k)) || 0) / 1e6;
    out.cash = months.map(m => pick(map[m], 'Cash'));
    out.currentAssets = months.map(m => pick(map[m], 'CA'));
    out.currentLiabilities = months.map(m => pick(map[m], 'CL'));
    out.equity = months.map(m => pick(map[m], 'Equity'));
  });

  out.entityByKey = Object.fromEntries(out.entities.map(e => [e.key, e]));
  out.refreshed = new Date().toISOString().replace('T', ' · ').slice(0, 19) + ' UTC';
  out._meta = { liveFields, fallbackFields: failed, note: 'Fields not listed as live use bundled sample values — extend server/dax.js to query them.' };
  return out;
}

module.exports = { buildShape, Q, DEPT_TO_KEY };
