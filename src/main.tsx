import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import { purgeDemoDataOnce } from './lib/store.ts';
import './styles/index.css';

/* ★ לפני שהאפליקציה עולה: מנקים נתוני הדגמה של מחזורים קודמים.
   רץ פעם אחת לכל epoch (ראו store.ts). קבוצת הניסוי חייבת
   להתחיל מדף חלק — הגשה ישנה או ניקוד פיקטיבי הורסים את האמון
   בדיוק ברגע שבו הוא הכי שביר. */
purgeDemoDataOnce();

const root = document.getElementById('root');
if (!root) throw new Error('#root לא נמצא');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/* ------------------------------------------------------------------ *
 * רישום Service Worker.
 * רק בפרודקשן: ב-dev הוא מתנגש עם ה-HMR של Vite ומגיש קבצים ישנים.
 * ------------------------------------------------------------------ */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // כישלון רישום לא שובר את האפליקציה — רק מוותר על עבודה אופליין
    });
  });
}
