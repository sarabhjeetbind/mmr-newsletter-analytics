/* ============================================================
   MMR Newsletter Analytics — runtime configuration
   ------------------------------------------------------------
   Flip `live` to true to load from the live Fabric semantic model
   (via the backend proxy in ./server), or from a static JSON snapshot.
   ============================================================ */
window.MMR_CONFIG = {
  // false → sample data (data.js).  true → live (proxy or dataUrl below).
  live: false,

  // Backend proxy origin. '' = same origin (recommended: serve the app FROM the proxy).
  // Example when hosted separately: 'https://mmr-proxy.yourcompany.com'
  apiBase: '',

  // OPTIONAL: fetch a static JSON snapshot directly, bypassing the proxy.
  // Handy for a cached daily export, offline demos, or testing the live path.
  // Leave '' to use the proxy at `${apiBase}/api/mmr`.
  dataUrl: '',
};
