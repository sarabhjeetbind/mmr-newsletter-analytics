/* ============================================================
   MMR Newsletter Analytics — backend proxy
   - Authenticates to Power BI with an Azure AD service principal (MSAL)
   - Runs DAX against the Fabric semantic model via executeQueries
   - Returns the window.MMR shape at GET /api/mmr (cached)
   - Serves the static app from the parent folder (same origin → no CORS)

   Run:  cp .env.example .env  (fill values)  →  npm install  →  npm start
   Mock: set MOCK=true in .env to serve bundled sample.json (no credentials).
   ============================================================ */
const path = require('path');
const fs = require('fs');
const express = require('express');
require('dotenv').config();
const { ConfidentialClientApplication } = require('@azure/msal-node');
const { buildShape } = require('./dax');

const {
  TENANT_ID, CLIENT_ID, CLIENT_SECRET, WORKSPACE_ID, DATASET_ID,
  PORT = 8787, MOCK = 'false', CACHE_MINUTES = '10',
} = process.env;

const app = express();
const APP_DIR = path.join(__dirname, '..');                 // the static front-end
const sample = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'mock-mmr.json'), 'utf8'));

// Allow the app to be embedded inside Power BI / Fabric web-content tiles.
const FRAME_ANCESTORS = process.env.FRAME_ANCESTORS ||
  "frame-ancestors 'self' https://app.powerbi.com https://*.powerbi.com https://app.fabric.microsoft.com https://*.fabric.microsoft.com";
app.use((_req, res, next) => { res.setHeader('Content-Security-Policy', FRAME_ANCESTORS); next(); });

/* ---------- Azure AD token (client credentials) ---------- */
let msal = null;
if (MOCK !== 'true') {
  msal = new ConfidentialClientApplication({
    auth: { clientId: CLIENT_ID, authority: `https://login.microsoftonline.com/${TENANT_ID}`, clientSecret: CLIENT_SECRET },
  });
}
async function getToken() {
  const r = await msal.acquireTokenByClientCredential({ scopes: ['https://analysis.windows.net/powerbi/api/.default'] });
  return r.accessToken;
}

/* ---------- executeQueries: run one DAX EVALUATE, return rows ---------- */
async function runQuery(dax) {
  const token = await getToken();
  const url = `https://api.powerbi.com/v1.0/myorg/groups/${WORKSPACE_ID}/datasets/${DATASET_ID}/executeQueries`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ queries: [{ query: dax }], serializerSettings: { includeNulls: true } }),
  });
  if (!res.ok) throw new Error(`executeQueries ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const t = json.results && json.results[0] && json.results[0].tables && json.results[0].tables[0];
  if (!t) throw new Error('executeQueries returned no table');
  return t.rows || [];
}

/* ---------- cached /api/mmr ---------- */
let cache = { at: 0, data: null };
app.get('/api/mmr', async (req, res) => {
  try {
    const ttl = Number(CACHE_MINUTES) * 60 * 1000;
    if (!req.query.refresh && cache.data && Date.now() - cache.at < ttl) return res.json(cache.data);
    let data;
    if (MOCK === 'true') { data = JSON.parse(JSON.stringify(sample)); data.refreshed = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' (mock proxy)'; data._meta = { mock: true }; }
    else data = await buildShape(runQuery, sample);
    cache = { at: Date.now(), data };
    res.json(data);
  } catch (e) {
    console.error('[api/mmr] error:', e);
    res.status(502).json({ error: 'Failed to load semantic-model data', detail: String(e.message || e) });
  }
});

app.get('/healthz', (_req, res) => res.json({ ok: true, mock: MOCK === 'true' }));

/* ---------- dynamic config: when the app is served BY the proxy, run in live mode
   (same origin → /api/mmr). Overrides the static config.js used for local/sample hosting. ---------- */
app.get('/config.js', (_req, res) => {
  res.type('application/javascript').send('window.MMR_CONFIG = { live: true, apiBase: "", dataUrl: "" };');
});

/* ---------- serve the app (same origin) ---------- */
app.use(express.static(APP_DIR));

app.listen(PORT, () => console.log(`MMR proxy on http://127.0.0.1:${PORT}  (MOCK=${MOCK})  → open / for the app, /api/mmr for data`));
