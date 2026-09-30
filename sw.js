// 네트워크 우선, 실패하면 캐시 (오프라인에서도 화면은 열리도록)
const C = 'wf-v1';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(C).then(c => c.addAll(['./', 'index.html', 'app.js', 'config.js', 'assets/emblem.png']).catch(() => {}))) });
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); return r }).catch(() => caches.match(e.request)));
});
