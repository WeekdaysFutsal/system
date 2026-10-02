// WD_FUTSAL service worker
// - 버전이 붙은 파일(app.js?v=, style.css?v=, config.js?v=)과 이미지: 저장본을 바로 쓰고(빠름), 새 버전은 주소가 달라져 자동으로 새로 받아요.
// - 앱 첫 화면(HTML): 항상 서버의 최신본을 먼저 확인하고, 오프라인이면 저장본을 써요.
const C = 'wf-0.19';
self.addEventListener('install', e => { self.skipWaiting() });
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  const versioned = u.searchParams.has('v') || /\/assets\//.test(u.pathname);
  const isDoc = e.request.mode === 'navigate' || u.pathname.endsWith('/') || u.pathname.endsWith('.html') || u.pathname.endsWith('.webmanifest');
  if (versioned) {
    e.respondWith(caches.open(C).then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r }))));
  } else if (isDoc || u.pathname.endsWith('.js')) {
    e.respondWith(fetch(e.request, { cache: 'no-store' }).then(r => { if (r.ok) { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)) } return r }).catch(() => caches.match(e.request, { ignoreSearch: true })));
  }
});
