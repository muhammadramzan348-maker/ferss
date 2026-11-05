// Generated into ../sw.js by tools/gen_sw.py (do not edit sw.js by hand).
const VERSION = 'ramzan-6c1e82edbf';
const FILES = [
 "./",
 "./index.html",
 "./manifest.webmanifest",
 "./css/app.css",
 "./icons/apple-touch-icon.png",
 "./icons/favicon-64.png",
 "./icons/icon-192.png",
 "./icons/icon-512.png",
 "./icons/maskable-512.png",
 "./img/banner.jpg",
 "./img/logo-256.png",
 "./img/logo-512.png",
 "./js/app.js",
 "./js/auth.js",
 "./js/core.js",
 "./js/db.js",
 "./js/gdrive.js",
 "./js/i18n.js",
 "./js/print.js",
 "./js/store.js",
 "./js/theme.js",
 "./js/ui/backup_actions.js",
 "./js/ui/ctx.js",
 "./js/ui/khata_screen.js",
 "./js/ui/main_screens.js",
 "./js/ui/ops_screens.js",
 "./js/ui/output.js",
 "./js/ui/settings_screen.js",
 "./js/ui/stock_screens.js"
];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// App files: cache first (works fully offline). Requests to other sites (e.g. Google Drive) are never touched.
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request).catch(() => caches.match('./index.html'))));
});
