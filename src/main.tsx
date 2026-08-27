import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import { purgeLocalGameData } from './lib/store.ts';
import { startClockSync } from './lib/serverTime.ts';
import { fetchServerTime } from './lib/supabase.ts';
import './styles/index.css';

/* ★ לפני שהאפליקציה עולה: מוחקים כל שריד של דאטת משחק מהמכשיר.
   מהסבב הזה **שום** נתון של המשחק לא נשמר מקומית — לא הגשות,
   לא תוצאות, ולא טיוטות. מה שנשאר מגרסאות קודמות כבר לא נקרא
   על ידי שום קוד, והוא רק מבלבל את מי שיפתח DevTools ויראה
   "הגשה" שאינה קיימת בשום מקום בעולם.

   ⚠ סשן ההזדהות (`sb-*`) לא נמחק — הוא הזהות, לא הדאטה. */
purgeLocalGameData();

/* ★ שעון השרת — נמצא כתוב, ומעולם לא הופעל.
   `serverTime.ts` היה מוכן במלואו, אבל אף אחד לא קרא ל-
   `startClockSync`. התוצאה: `serverNow()` החזיר בדיוק
   `Date.now()`, והספירה לאחור בלובי רצה על שעון המכשיר.
   משתמש עם שעון שמאחר ראה "פתוח" אחרי הדדליין, לחץ להגיש,
   וקיבל דחייה מהשרת בלי להבין למה.

   נכשל בשקט: אם אין רשת, ההיסט נשאר 0 וההתנהגות זהה לקודם. */
startClockSync(fetchServerTime);

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
