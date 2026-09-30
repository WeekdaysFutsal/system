// 항상 서버의 최신 파일을 먼저 확인하고(브라우저 캐시 무시), 오프라인일 때만 저장해 둔 파일을 써요.
const C = 'wf-1.7';
self.addEventListener('install', e => { self.skipWaiting() });
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(u.href, { cache: 'no-store', credentials: 'same-origin' }).then(r => { if (r.ok) { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)) } return r }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
