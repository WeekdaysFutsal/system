// 푸시 알림(Firebase Cloud Messaging): 앱이 꺼져 있어도 알림을 받아요.
try {
  importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js', 'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
  firebase.initializeApp({ apiKey: 'AIzaSyCvO0DUvGG0i8gRJ74Ppn1aqUZ3QiG5pFs', authDomain: 'wd-futsal.firebaseapp.com', projectId: 'wd-futsal', storageBucket: 'wd-futsal.firebasestorage.app', messagingSenderId: '663428055388', appId: '1:663428055388:web:92aaceb1b0c5088176c199' });
  firebase.messaging();
} catch (e) { /* 오프라인 등으로 못 불러와도 앱은 정상 동작 */ }
self.addEventListener('notificationclick', e => { e.notification.close(); const url = e.notification?.data?.FCM_MSG?.fcmOptions?.link || e.notification?.data?.link || self.registration.scope;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => { for (const w of ws) if (w.url.startsWith(self.registration.scope) && 'focus' in w) return w.focus(); return clients.openWindow(url) })) });
// WD_FUTSAL service worker
// - 버전이 붙은 파일(app.js?v=, style.css?v=, config.js?v=)과 이미지: 저장본을 바로 쓰고(빠름), 새 버전은 주소가 달라져 자동으로 새로 받아요.
// - 앱 첫 화면(HTML): 항상 서버의 최신본을 먼저 확인하고, 오프라인이면 저장본을 써요.
const C = 'wf-0.21.15';
self.addEventListener('install', e => { self.skipWaiting() });
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  const versioned = u.searchParams.has('v') || /\/assets\//.test(u.pathname);
  const isDoc = e.request.mode === 'navigate' || u.pathname.endsWith('/') || u.pathname.endsWith('.html') || u.pathname.endsWith('.webmanifest');
  if (versioned) {
    e.respondWith(caches.open(C).then(c => c.match(e.request).then(hit => { const net = fetch(e.request, { cache: 'no-cache' }).then(r => { if (r.ok) c.put(e.request, r.clone()); return r }).catch(() => hit); if (hit) { e.waitUntil(net); return hit } return net })));  // 저장본을 바로 쓰고, 뒤에서 최신본으로 바꿔 둬요
  } else if (isDoc || u.pathname.endsWith('.js')) {
    e.respondWith(fetch(e.request, { cache: 'no-store' }).then(r => { if (r.ok) { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)) } return r }).catch(() => caches.match(e.request, { ignoreSearch: true })));
  }
});
