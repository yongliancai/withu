// Service worker: app-shell cache + push notifications.
const VERSION = 'v14';
const SHELL = ['/', '/index.html', '/app.js', '/art.js', '/styles.css', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return; // always live
  if (url.origin === location.origin) {
    // network first for the shell so updates land quickly; fall back to cache offline
    e.respondWith(fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('/index.html'))));
    return;
  }
  if (url.hostname.endsWith('gstatic.com') || url.hostname.endsWith('googleapis.com')) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return res;
    })));
  }
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch { d = { title: '新訊息', body: '' }; }
  const jobs = [self.registration.showNotification(d.title || '新訊息', {
    body: d.body, tag: d.tag, renotify: !d.silent, silent: !!d.silent, icon: '/icons/icon-192.png', badge: '/icons/badge-72.png', data: { url: d.url || '/' },
  })];
  // App 圖示上的未讀數字（加入主畫面後才看得到）
  if (typeof d.badge === 'number' && self.navigator.setAppBadge) jobs.push(d.badge > 0 ? self.navigator.setAppBadge(d.badge) : self.navigator.clearAppBadge());
  e.waitUntil(Promise.all(jobs).catch(() => {}));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) { c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
