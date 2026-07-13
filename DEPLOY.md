# Deploying to the "Newsletter Analytics" Fabric app

This app is a web app (HTML/JS), so surfacing it inside a Fabric/Power BI **app** is two moves:

1. **Host** the app at an HTTPS URL.
2. **Embed** that URL in the *Newsletter Analytics* app (a Power BI **Dashboard → Web-content tile**, then publish/update the app).

> Both steps run in **your** Azure + Power BI/Fabric tenant under your account. They can't be done from here (no access to your tenant, and hosting needs your credentials). Everything below is copy-paste ready — the framing headers, host config, and container are already in the repo.

---

## Step 1 — Host the app

Pick the path that matches how you want data to flow.

### Option A — Static hosting (fastest; sample or snapshot data)
Serves the front-end only. Data = bundled sample, **or** a static JSON snapshot you export from the model (`config.js` → `dataUrl`). No backend, no credentials.

**Azure Static Web Apps** (config already included: `staticwebapp.config.json`):
```bash
npm install -g @azure/static-web-apps-cli
# from THIS folder (the app root):
swa deploy . --env production
```
…or in the Portal: **Create → Static Web App → “Other/No framework”**, app location `/`, upload this folder. Any static host works too (Azure Blob $web, Netlify, S3+CloudFront) — just keep the `Content-Security-Policy: frame-ancestors …` header from `staticwebapp.config.json` so Power BI can frame it.

### Option B — Live data (front-end + proxy in one container)  ← selected
Serves the app **and** `/api/mmr` (DAX → your Fabric semantic model). Requires the service principal from [`server/README.md`](server/README.md).

**No front-end edit needed:** when the app is served by the proxy it auto-runs in live mode — the proxy serves a dynamic `/config.js` with `live:true`, same origin. (The static `config.js` file stays `live:false`, so local/static hosting still shows sample.)

**One-command deploy to Azure Container Apps** (script included — run from the app root, after `az login`):
```bash
cd "MMR Newsletter Analytics - OpenBI App"
export TENANT_ID=... CLIENT_ID=... CLIENT_SECRET=... WORKSPACE_ID=... DATASET_ID=...
bash server/deploy-azure.sh          # builds the image, creates the app, sets the secret + env, prints the URL
```
The script builds `Dockerfile`, creates the Container App with external ingress on port 8787, stores `CLIENT_SECRET` as a Container Apps secret (`secretref`), sets `MOCK=false`, and prints the HTTPS URL.

**Prefer App Service?** Deploy the same image (`docker build -t mmr-analytics .` → push to ACR → App Service for Containers), set the same env vars as **application settings**, and put `CLIENT_SECRET` in **Key Vault**.

**No Azure subscription? Host on Render (recommended here)** — `render.yaml` is included:
1. Put this app folder in a Git repo (GitHub/GitLab). `.gitignore` already excludes `server/.env` and `node_modules`.
   ```bash
   cd "MMR Newsletter Analytics - OpenBI App"
   git init && git add -A && git commit -m "MMR Newsletter Analytics app + proxy"
   git branch -M main && git remote add origin <your-repo-url> && git push -u origin main
   ```
2. Render → **New + → Blueprint** → connect the repo → it reads `render.yaml` (Docker web service, free plan, health check `/healthz`).
3. In the service's **Environment**, set the three secrets: `TENANT_ID`, `CLIENT_ID`, `CLIENT_SECRET`. `WORKSPACE_ID` / `DATASET_ID` are pre-filled in `render.yaml`; `MOCK=false` for live.
4. Deploy → Render gives an HTTPS URL like `https://mmr-newsletter-analytics.onrender.com`.

**Railway alternative (no Git needed):** `npm i -g @railway/cli && railway login && railway up` from the app folder, then set the same env vars in the Railway dashboard.

**Verify after deploy:**
- `https://<url>/healthz` → `{ "ok": true, "mock": false }`
- `https://<url>/api/mmr` → check `_meta.liveFields` (which slices came from the model) and `_meta.fallbackFields` (still sample — extend `server/dax.js`).
- Open `https://<url>/` → top-bar pill reads **"● Live · Fabric"**.

> Tip: deploy first with `MOCK=true` (skip the secret/env step) to confirm hosting + the Fabric embed work, then set `MOCK=false` once the service principal is validated.

After hosting, confirm the URL loads over **HTTPS** and shows the dashboard.

---

## Step 2 — Add it to the *Newsletter Analytics* Fabric app

Power BI apps distribute a workspace's content. Embed the hosted URL via a **Web-content tile** on a dashboard, then include that dashboard in the app.

1. In the **Power BI/Fabric Service**, open the **workspace** behind the *Newsletter Analytics* app.
2. **New → Dashboard** (e.g. "Newsletter Analytics — Web"), or open an existing one → **Edit**.
3. **Add tile → Web content → Next**, and paste:
   ```html
   <iframe src="https://YOUR-HOSTED-URL" width="1280" height="720" frameborder="0" style="border:0;"></iframe>
   ```
4. **Apply**, then drag the tile to full width. (Tip: set the tile to open the full app on click.)
5. **Update the app:** workspace → **Update app** → *Content* tab: make sure the dashboard is included → *Audience*: confirm who sees it → **Update app**.

The dashboard (with your live web app inside it) now appears in the *Newsletter Analytics* app navigation for its audience.

### Requirements & gotchas
- **HTTPS only** — Power BI won't frame `http://`.
- **Framing** — the host must send `Content-Security-Policy: frame-ancestors … app.powerbi.com …` (the proxy sets this automatically; the static config includes it). Don't send `X-Frame-Options: DENY`.
- **Tenant setting** — an admin may need *Admin portal → Tenant settings → “Web content tiles”* enabled.
- **Live data** — the proxy must be publicly reachable over HTTPS and the service principal / capacity / *Execute Queries* setting configured (see `server/README.md`).
- **Alternative to a tile** — a Fabric **org app** can also add a **Link** in its navigation pointing straight at the hosted URL (no dashboard needed), if you prefer a full-page experience.

---

## Recap of what's already in the repo for you
| Artifact | Purpose |
|---|---|
| `staticwebapp.config.json` | Azure Static Web Apps routing + framing header (Option A) |
| `Dockerfile`, `.dockerignore` | Container for the app + live proxy (Option B) |
| `server/` + `server/README.md` | Live-data proxy (service principal + DAX) and its setup |
| `config.js` | Flip `live` / set `apiBase` / `dataUrl` to choose the data source |
| CSP `frame-ancestors` (proxy + static config) | Lets Power BI/Fabric embed the app |
