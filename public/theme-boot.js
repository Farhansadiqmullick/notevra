// No-flash theme boot: stamp the saved theme BEFORE Vue mounts (FRONTEND_WORKFLOW §1.4); a file, not inline, so the CSP can forbid inline scripts.
try {
  var t = JSON.parse(localStorage.getItem('theme') || '{}');
  var el = document.documentElement;
  el.dataset.theme = t.palette || 'indigo';
  if (t.font) el.dataset.font = t.font;
  el.dataset.mode =
    t.mode || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  // the status bar is chrome, not content — it has to be right on the FIRST paint too,
  // otherwise an installed dark-mode app flashes a light bar on every cold launch
  var m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', el.dataset.mode === 'dark' ? '#17181c' : '#eeeff4');
} catch (e) {}
