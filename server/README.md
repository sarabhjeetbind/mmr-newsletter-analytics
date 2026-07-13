# MMR Newsletter Analytics — live-data proxy

A small Node/Express backend that authenticates to Power BI with an **Azure AD service principal**, runs **DAX** against the *MMR Newsletter Analytics* Fabric semantic model via the **executeQueries** REST API, and serves the results (shaped as `window.MMR`) to the front-end at `GET /api/mmr`. It also serves the static app, so the browser and the data API share one origin (no CORS).

```
Browser (app)  ──GET /api/mmr──▶  proxy  ──executeQueries (DAX)──▶  Fabric semantic model
      ▲                                   │
      └───────────── static app ──────────┘   (same origin → no CORS, no tokens in the browser)
```

## Why a proxy is required
The browser **cannot** call `executeQueries` directly: it needs an OAuth2 token, and the Power BI REST API doesn't send CORS headers for browser origins. The proxy holds the credential server-side and exposes a clean same-origin JSON endpoint.

## 1. Prerequisites (done once, by a Fabric admin)
1. **Capacity:** the workspace holding the model must be on **Fabric / Power BI Premium / PPU** (required for XMLA + executeQueries).
2. **Service principal:** register an Azure AD app → create a **client secret** → note the **Tenant ID**, **Client ID**, **Client secret**.
3. **Tenant setting:** Power BI Admin portal → *Developer settings* → enable **“Service principals can use Power BI APIs”** (and **“Dataset Execute Queries REST API”**) for a security group that contains the service principal.
4. **Workspace access:** add the service principal to the workspace as **Member/Contributor** (or grant the dataset **Build** permission).
5. Note the **Workspace (group) ID** and **Dataset (semantic model) ID** from the dataset's URL in the Power BI service.

> None of these secrets are ever entered into Claude or the app — they live only in `server/.env` on your host.

## 2. Configure & run
```bash
cd "MMR Newsletter Analytics - OpenBI App/server"
cp .env.example .env        # then edit .env with the values above
npm install
npm start                   # → http://127.0.0.1:8787  (serves the app + /api/mmr)
```
Then set the front-end to live mode in `../config.js`:
```js
window.MMR_CONFIG = { live: true, apiBase: '', dataUrl: '' };  // '' apiBase = same origin as the proxy
```
Open `http://127.0.0.1:8787/` — the top-bar pill reads **“● Live · Fabric”** when data came from the model.

**First run with no credentials:** keep `MOCK=true` in `.env` — the proxy serves the bundled sample so you can confirm the plumbing, then flip to `MOCK=false` once the service principal is ready.

## 3. Validate / extend the DAX  (`dax.js`)
`dax.js` ships queries for the **core executive metrics** — revenue by entity, prior-year, FTE, billability, and the balance sheet — using the real model measures (`FX_PNL_CAD_TI`, `KPI_FTE_Adj`, `Billability Percent_Avg`, `1500/2500/1060/3600_*`, etc.). Everything else (client list, AR aging by client, credit notes, backlog, unassigned hours, FX rates) currently falls back to the bundled sample.

- **Verify each query** in Power BI Desktop → *DAX query view* → paste the `EVALUATE` and run. Adjust any measure/column/table name that doesn't resolve in your model.
- **Extend coverage:** add a query + mapping in `dax.js` for each remaining field. `GET /api/mmr` returns `_meta.liveFields` / `_meta.fallbackFields` so you can see live vs sample at a glance.
- Queries that error are caught per-field (logged as `[dax] <field> fell back to sample`) so the app never goes blank while you iterate.

## 4. Deploy (production)
- Host the proxy on any Node host (Azure App Service, Container Apps, a VM). Set the env vars as app settings (use **Key Vault** for `CLIENT_SECRET`).
- Point `config.js` `apiBase` at the proxy origin (or serve the app from the proxy and keep `apiBase: ''`).
- **Embed in Fabric:** add the hosted URL to a Fabric/Power BI **app** as a website/embed tile.
- Data is cached `CACHE_MINUTES` (default 10); `GET /api/mmr?refresh=1` forces a refresh.

## Files
| File | Role |
|---|---|
| `index.js` | Express server: MSAL auth, executeQueries, caching, static serving, `/api/mmr`, `/healthz` |
| `dax.js` | DAX query strings + mapper to the `window.MMR` shape |
| `.env.example` | Copy to `.env`; MOCK flag, service-principal creds, workspace/dataset IDs |
| `package.json` | Dependencies: express, @azure/msal-node, dotenv |
