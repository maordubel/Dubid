import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync } from 'node:fs';

// אין כאן `base` מותאם: האפליקציה יושבת בשורש הדומיין
// (dubid.dubelteam.com), ולכן ברירת המחדל '/' נכונה.

/**
 * ★★ מזהה בנייה — הדבר היחיד שמונע מ-Service Worker להקפיא את האתר ★★
 *
 * `public/sw.js` מכיל את המחרוזת `__BUILD_ID__`. אם אף אחד לא
 * מחליף אותה, גרסת המטמון קבועה לנצח, הישן לעולם לא נמחק,
 * והמשתמש מקבל **HTML חדש עם נכסים ישנים** — כלומר אתר בלי
 * גיליון סגנונות.
 *
 * זה קרה בפועל, והסיבה הייתה הערה בקוד שכתבה "גרסה משתנה בכל
 * דיפלוי" מעל קבוע שמעולם לא השתנה.
 *
 * הפתרון הוא לא לזכור לעדכן. **מה שדורש לזכור — לא מתעדכן.**
 * לכן זה קורה אוטומטית בכל בנייה.
 */
const BUILD_ID = String(Date.now());

function stampServiceWorker() {
  return {
    name: 'dubid-sw-build-id',
    /* `closeBundle` ולא `writeBundle`: רץ אחרי שכל הפלט נכתב,
       כולל ההעתקה של `public/` לתוך `dist/`. */
    closeBundle() {
      try {
        const file = 'dist/sw.js';
        const src = readFileSync(file, 'utf8');
        if (!src.includes('__BUILD_ID__')) {
          console.warn('  ⚠  sw.js: לא נמצא __BUILD_ID__ — המטמון לא יתחדש!');
          return;
        }
        writeFileSync(file, src.split('__BUILD_ID__').join(BUILD_ID));
        console.log(`  sw.js  →  build ${BUILD_ID}`);
      } catch {
        /* אין sw.js בפלט — לא מפילים בנייה בשביל זה. */
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), stampServiceWorker()],
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // המנוע והכרטיס נטענים בנפרד מהמעטפת — המסך הראשון קל יותר
        manualChunks: {
          scoring: ['./src/lib/scoring/engine.ts'],
          sharecard: ['./src/lib/shareCard.ts', './src/lib/qr.ts'],
        },
      },
    },
  },
  server: { port: 5173, host: true },
  preview: { port: 4173 },
});
