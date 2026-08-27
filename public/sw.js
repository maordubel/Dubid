/**
 * sw.js — Service Worker.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★★ הבאג שהחזיק את האתר כבן ערובה ★★
 * ═══════════════════════════════════════════════════════════════
 *
 * הגרסה הקודמת פתחה כך:
 *
 *     // גרסה משתנה בכל דיפלוי -> ניקוי מטמונים ישנים אוטומטי
 *     const VERSION = 'dubid-v1';
 *
 * ההערה תיארה כוונה. הקוד תיאר קבוע. **הגרסה מעולם לא השתנתה.**
 *
 * מה שקרה בפועל: נכסים הוגשו `cache-first` לנצח, בעוד הניווט
 * הוגש `network-first`. כלומר הדפדפן קיבל **HTML חדש שמצביע על
 * נכסים בשמות חדשים, ו-Service Worker ישן שמחזיק מטמון ישן** —
 * והתוצאה היא דף שנטען בלי גיליון הסגנונות שלו.
 *
 * זה נראה בדיוק כמו "העיצוב נמחק": כותרות בגודל ברירת מחדל,
 * כפתורים אפורים, ורקע כהה שמגיע מ-`color-scheme: dark` ולא
 * מהמוצר. ו-`Ctrl+Shift+R` לא עוזר, כי ה-SW חוטף את הבקשה
 * לפני שהיא מגיעה לרשת.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ שלושה תיקונים, וכל אחד מהם לבדו היה מספיק
 * ═══════════════════════════════════════════════════════════════
 *
 *  1. **הגרסה נגזרת מהבנייה.** `__BUILD_ID__` מוחלף על ידי Vite
 *     בזמן build. דיפלוי חדש = מטמון חדש = הישן נמחק. אי אפשר
 *     לשכוח לעדכן אותו, כי אף אחד לא מעדכן אותו ידנית.
 *
 *  2. **נכסים מגובבים הם network-first.** `/assets/*` נושא hash
 *     בשם — התוכן שלו לעולם לא משתנה תחת אותו שם, ולכן אין שום
 *     רווח ב-cache-first, ויש הפסד עצום: קובץ שנתפס פעם אחת
 *     נשאר לנצח. עכשיו: רשת קודם, מטמון רק כשאין רשת.
 *
 *  3. **מתג כיבוי.** הדף יכול לבקש מה-SW למחוק את עצמו. משתמש
 *     תקוע לא צריך DevTools כדי להשתחרר.
 *
 * ★ ומה שנשאר: המטרה המקורית עדיין מתקיימת — האפליקציה נפתחת
 *   באצטדיון, איפה שהרשת גוססת. פשוט לא במחיר של אתר קפוא.
 */

/* `__BUILD_ID__` מוחלף ב-vite.config.ts בזמן הבנייה. אם מישהו
   פותח את הקובץ ישירות בלי build, הערך נשאר כמחרוזת — וזה בסדר,
   כי אז אין בכלל דיפלוי. */
const VERSION = '__BUILD_ID__';
const SHELL = `dubid-${VERSION}-shell`;
const DATA = `dubid-${VERSION}-data`;

/* ★ `index.html` **לא** ברשימה, ובכוונה.
   הוא הקובץ היחיד שחייב להיות טרי תמיד — הוא זה שמצביע על שמות
   הנכסים. מטמון שלו הוא בדיוק הבאג שתוקן כאן. */
const SHELL_ASSETS = [
  '/manifest.webmanifest',
  '/icons/seal-192.png',
  '/icons/seal-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      // ★ `allSettled` ולא `addAll`: קובץ אחד חסר לא צריך להכשיל
      //   את ההתקנה כולה ולהשאיר את המשתמש בלי SW בכלל.
      .then((c) => Promise.allSettled(SHELL_ASSETS.map((a) => c.add(a))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.includes(VERSION)).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

/* ★ מתג כיבוי מרחוק.
   הדף שולח הודעה, וה-SW מוחק את כל המטמונים ואת עצמו. */
self.addEventListener('message', (event) => {
  if (event.data === 'sw:kill') {
    event.waitUntil(
      caches.keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .then(() => self.registration.unregister()),
    );
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;               // הגשות עוברות ישר לרשת

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;    // פונטים/CDN — לא שלנו

  /* ── ניווט: תמיד מהרשת.
     ה-HTML מצביע על שמות הנכסים, ולכן HTML ישן הוא אתר שבור. ── */
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(request)));
    return;
  }

  /* ── ★ נכסים מגובבים: network-first.
     `/assets/index-a1b2c3.css` נושא hash — התוכן שלו לעולם לא
     משתנה תחת אותו שם. cache-first לא חוסך כלום, ועולה באתר
     שנתקע על גרסה ישנה. ── */
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => caches.match(request)),
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

  /* ── תמונות, סמלים, לוגו: cache-first.
     אלה באמת סטטיים, ואין להם hash בשם. ── */
  event.respondWith(
    caches.match(request).then((cached) =>
      cached ??
      fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(request, copy));
        }
        return res;
      }),
    ),
  );
});
