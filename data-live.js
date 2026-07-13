/* ============================================================
   MMR Newsletter Analytics — live data loader
   Fetches the semantic-model metrics (already shaped as window.MMR)
   from the backend proxy, or from a static JSON snapshot (dataUrl).
   The proxy (./server) runs the DAX and returns this exact shape.
   ============================================================ */
window.loadLive = async function (cfg) {
  const url = (cfg.dataUrl && cfg.dataUrl.length) ? cfg.dataUrl : ((cfg.apiBase || '') + '/api/mmr');
  const res = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'omit' });
  if (!res.ok) throw new Error('Live data request failed: HTTP ' + res.status);
  const data = await res.json();
  // minimal shape validation so a bad response falls back to sample instead of a blank app
  const required = ['months', 'entities', 'fte', 'billability', 'arTotal', 'currentAssets', 'currencies'];
  const missing = required.filter(k => !(k in data));
  if (missing.length) throw new Error('Live data missing fields: ' + missing.join(', '));
  // rebuild convenience index if the proxy didn't include it
  if (!data.entityByKey) data.entityByKey = Object.fromEntries(data.entities.map(e => [e.key, e]));
  return data;
};
