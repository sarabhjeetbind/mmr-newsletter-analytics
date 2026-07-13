# MMR Newsletter Analytics — OpenBI App

A fresh, OpenBI-branded interactive web dashboard that reimagines the *MMR Newsletter Analytics* Power BI report. Covers **all 20 report pages**, grouped in the sidebar:

- **Overview** — Home
- **Revenue** — Revenue, Client Revenue, Top N Client, Act vs. PY
- **Resourcing** — Resource Management, Billability, Billable Hours, Non-Billable Hours, Week of Supply, Hours Remaining
- **Backlog** — Backlog, Unassigned Hours
- **Receivables** — AR Aging Summary, AR by Type, TTM AR Summary
- **Finance** — Working Capital, Assets & Liabilities, FX Rates, Credit Notes

> **Data status:** ships with **representative sample data** (`data.js`) by default; a full **live-data path** to the Fabric semantic model is built and ready — flip one flag in `config.js` and run the proxy in `server/`. See *Going live* below.

## Run it

The app is a static bundle — no build step.

- **Quick view:** double-click `index.html` (works from `file://`; the chart engine is an IIFE).
- **Recommended (matches production):** serve the folder over HTTP and open `http://127.0.0.1:8777/`:
  ```
  py -m http.server 8777
  ```

## What's inside

| File | Role |
|---|---|
| `index.html` | App shell — sidebar nav, topbar (entity/currency/period/interaction controls, theme), 20 view containers, boot loader |
| `app.js` | Rendering + interactivity: KPI cards, charts, tables, cross-filter, highlight, all control wiring |
| `data.js` | **Sample data** (default source) |
| `config.js` | Runtime config — `live` flag, proxy `apiBase`, optional static `dataUrl` |
| `data-live.js` | Live loader — fetches the shaped metrics from the proxy / snapshot |
| `mock-mmr.json` | Sample shape as JSON (proxy fallback + live-path testing) |
| `server/` | Live-data proxy (Node/Express + service principal + DAX). See `server/README.md` |
| `colors_and_type.css` | OpenBI design tokens (source of truth — do not hardcode hex) |
| `openbi-charts.js` | OpenBI chart engine (`window.OpenBICharts`: line, donut, groupedBar, sparkline) |
| `assets/logos/`, `fonts/` | OpenBI brand assets |

## Features

- **5 views** with a persistent left nav rail, dynamic titles, and refresh stamp.
- **Entity filter** (multi-select popover) — scopes every entity-decomposable view to the selected MMR departments.
- **Currency selector** (CAD / USD / INR / SGD / AUD) — every monetary figure and chart re-renders live.
- **Period selector** (MTD / QTD / YTD) driving the revenue KPIs (fiscal year starts September).
- **Local-currency (LC) / CAD toggle** on revenue-family pages (the report's field-parameter behaviour).
- **Top-N slider** (Top N Client), **as-of-date** (AR pages), **FTE-hours** (Billability / Billable Hours) and **max-hours** (Hours Remaining) parameters.
- **Drill-down** table on Hours Remaining (employee → client → project → task).
- **Cross-filtering** — click a chart element or table row to filter/focus the page; a clearable chip shows the selection; nav clears it.
- **Interaction toggle (Highlight / Filter)** — *Highlight* (default) dims non-selected marks and keeps everything visible; *Filter* removes non-selected data. Set in the top bar.
- **Light / dark theme** — a true peer, not a skin (persisted to `localStorage`).
- OpenBI chart engine throughout: multi-series lines (time trends), donuts (composition), grouped bars (ranking), KPI sparklines.

## Going live (wire to the Fabric semantic model)

The live-data path is **already built** — a backend proxy runs DAX against the model and serves the exact `window.MMR` shape:

```
Browser (app)  ──GET /api/mmr──▶  proxy (server/)  ──executeQueries (DAX)──▶  Fabric semantic model
```

A browser can't call `executeQueries` directly (OAuth + no CORS), so the proxy authenticates with an Azure AD **service principal** and exposes a same-origin JSON endpoint.

**Steps** (full detail in [`server/README.md`](server/README.md)):
1. `cd server && cp .env.example .env` — keep `MOCK=true` for a credential-free first run.
2. `npm install && npm start` → `http://127.0.0.1:8787`.
3. In `config.js` set `live: true` (`apiBase: ''` = same origin as the proxy).
4. Provide the service principal + workspace/dataset IDs in `.env`, set `MOCK=false`, and **validate the DAX** in `server/dax.js` against your model.

`server/dax.js` ships the core executive queries (revenue by entity, prior-year, FTE, billability, balance sheet) mapped to the real measures; extend it for the remaining fields (each unmapped field falls back to sample and is listed in `/api/mmr` → `_meta.fallbackFields`). Secrets stay in `server/.env` (gitignored) — never in the browser or in this project's source.

**Alternative:** `config.js` `dataUrl` can point at a static JSON snapshot (e.g. a nightly export) to skip the live proxy entirely.

## Publishing as a Fabric app

This bundle is the **new front-end**. To surface it inside Microsoft Fabric:

- Host the folder (SharePoint / Azure Static Web Apps / any static host) and add it to a Fabric/Power BI app as an **Embed / website tile**, **or**
- Use it as the approved design spec and rebuild these views as native Power BI report pages on the same semantic model, then publish that report to your workspace and package it as a Fabric app.

Publishing the app itself happens in the Power BI/Fabric service under your account.

---
Built with the OpenBI design system. Tokens, chart engine, and brand assets are vendored in this folder so the bundle is self-contained and portable.
