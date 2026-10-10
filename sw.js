const C = 'sp-v7';
const CORE = ['./', './admin.html', './worker.html', './app.js', './config.js', './manifest-admin.json', './manifest-worker.json', './icon-admin-192.png', './icon-admin-512.png', './icon-worker-192.png', './icon-worker-512.png'];
const CDN = ['https://cdn.tailwindcss.com', 'https://unpkg.com/lucide@0.441.0/dist/umd/lucide.min.js'];
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(C).then(async c => {
    await Promise.all(CORE.map(u => c.add(u).catch(() => {})));
    await Promise.all(CDN.map(u => fetch(u, {mode: 'no-cors'}).then(r => c.put(u, r)).catch(() => {})));
  }));
});
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => clients.claim())));
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || !/^https?:/.test(r.url) || /googleapis\.com|script\.google\.com|googleusercontent\.com/.test(r.url)) return;
  e.respondWith(fetch(r).then(res => {
    if (res && res.status === 200 || res.type === 'opaque') { const k = res.clone(); caches.open(C).then(c => c.put(r, k)).catch(() => {}); }
    return res;
  }).catch(() => caches.match(r).then(m => m || (r.mode === 'navigate' ? caches.match(/worker/.test(r.url) ? './worker.html' : './admin.html') : Response.error()))));
});
