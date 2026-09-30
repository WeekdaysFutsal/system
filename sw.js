// 앱 파일(HTML, JS)은 항상 서버의 최신본을 먼저 확인하고, 오프라인일 때만 저장본을 써요.
// 이미지 등 나머지 파일은 브라우저 기본 방식에 맡겨요.
const C = 'wf-1.14';
self.addEventListener('install', e => { self.skipWaiting() });
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  const isApp = e.request.mode === 'navigate' || /\.(html|js|webmanifest)$/.test(u.pathname) || u.pathname.endsWith('/');
  if (!isApp) return;
  e.respondWith(fetch(e.request, { cache: 'no-store' }).then(r => { if (r.ok) { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)) } return r }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
