/**
 * sw.js — Service Worker.
 *
 * המטרה היחידה: שהאפליקציה תיפתח באצטדיון, איפה שהרשת גוססת.
 *
 *   · App shell  — cache-first. נטען מיידית, מתעדכן ברקע.
 *   · GET ל-API  — stale-while-revalidate. מציגים את המחזור האחרון
 *                  שהיה ואז מרעננים. עדיף נתון בן דקה מאשר ספינר.
 *   · POST/PATCH — network-only. הגשת הרכב לא נשמרת במטמון לעולם.
 *
 * גרסה משתנה בכל דיפלוי -> ניקוי מטמונים ישנים אוטומטי.
 */
const VERSION = 'dubid-v1';
const SHELL = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/seal-192.png',
  '/icons/seal-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;               // הגשות עוברות ישר לרשת

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;    // פונטים/CDN — לא שלנו

  // ניווט: network-first עם נפילה ל-shell (SPA)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html')),
    );
    return;
  }

  // API: stale-while-revalidate
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/rest/v1/')) {
    event.respondWith(
      caches.open(DATA).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((res) => { if (res.ok) cache.put(request, res.clone()); return res; })
          .catch(() => cached);
        return cached ?? network;
      }),
    );
    return;
  }

  // נכסים: cache-first
  event.respondWith(
    caches.match(request).then((cached) =>
      cached ??
      fetch(request).then((res) => {
        if (res.ok) caches.open(SHELL).then((c) => c.put(request, res.clone()));
        return res;
      }),
    ),
  );
});
