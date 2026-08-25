/**
 * components/RegisterNudge.tsx — ההצעה להירשם.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ מתי היא מופיעה, ולמה דווקא אז
 * ═══════════════════════════════════════════════════════════════
 *
 * **רק אחרי שיש מה להגן עליו.**
 *
 * אורח שנכנס עכשיו ועוד לא בחר שחקן אחד לא מסכן כלום. הצעה
 * להירשם באותו רגע היא מס כניסה — בדיוק מה שהמוצר החליט לא
 * לגבות. אותה הצעה בדיוק, אחרי שהוא הגיש הרכב, מתארת סיכון
 * אמיתי: ההרכב הזה חי בדפדפן אחד.
 *
 * לכן `hasSomethingToLose` הוא תנאי ולא קישוט.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ ארבעה כללים שהופכים דחיפה לנימוס
 * ═══════════════════════════════════════════════════════════════
 *
 *  1. **סגירה אמיתית.** ה-× לא מסתיר עד רענון — הוא משתיק
 *     למחזור שלם. באנר שחוזר אחרי שסגרו אותו הוא באנר שלמדו
 *     להתעלם ממנו.
 *  2. **בלי מספרים מומצאים.** אין "עוד 3 שניות", אין "12,000
 *     נרשמו היום". דחיפות מזויפת נתפסת, ואז כל השאר נחשד.
 *  3. **שורה אחת.** אם צריך פסקה כדי להסביר למה כדאי — התשובה
 *     היא שלא כדאי.
 *  4. **אף פעם לא חוסמת.** זו רצועה בזרימת המסך, לא מודאל.
 *     אפשר לגלול מעליה, והמשחק ממשיך בלעדיה.
 *
 * ההחלטה *מתי* לא נמצאת כאן אלא ב-`lib/nudge.ts` — טהורה, בלי
 * DOM, ועם בדיקות. `node --experimental-strip-types` לא טוען
 * `.tsx`, ולכן כלל שחי בקומפוננטה הוא כלל בלי בדיקה.
 */
import { useState } from 'react';
import { NUDGE_DISMISS_KEY } from '../lib/nudge.ts';

export function readDismissed(): number | null {
  try {
    const raw = localStorage.getItem(NUDGE_DISMISS_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

export function RegisterNudge({
  gameweekNumber, published, onOpen,
}: {
  gameweekNumber: number;
  /** אחרי פרסום המסר משתנה: כבר לא "ההרכב" אלא "התוצאה". */
  published: boolean;
  onOpen: () => void;
}) {
  const [gone, setGone] = useState(false);
  if (gone) return null;

  const dismiss = () => {
    try { localStorage.setItem(NUDGE_DISMISS_KEY, String(gameweekNumber)); } catch { /* מצב פרטי */ }
    setGone(true);
  };

  return (
    <section
      aria-label="שמירת החשבון"
      className="relative overflow-hidden rounded-2xl bg-night-2 edge-gold"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px
                   bg-gradient-to-l from-transparent via-gold/60 to-transparent"
      />

      <button
        type="button"
        onClick={dismiss}
        aria-label="לא להציג שוב במחזור הזה"
        className="absolute end-0 top-0 grid size-10 place-items-center text-chalk-dim
                   transition-colors hover:text-chalk"
      >
        ×
      </button>

      <div className="flex items-center gap-3 px-3.5 py-3 pe-10">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gold/10
                         text-gold ring-1 ring-inset ring-gold/30">
          <ShieldIcon />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-black leading-tight text-chalk">
            {published
              ? 'התוצאה שלכם שמורה בדפדפן הזה בלבד'
              : 'ההרכב שלכם שמור בדפדפן הזה בלבד'}
          </p>
          <p className="mt-0.5 text-[11.5px] leading-snug text-chalk-2">
            חשבון לוקח חצי דקה, ושומר הכל גם אם תחליפו מכשיר.
          </p>
        </div>

        <button
          type="button"
          onClick={onOpen}
          className="tap shrink-0 rounded-full bg-gradient-to-b from-gold-light to-gold
                     px-3.5 py-2 text-[12px] font-black text-gold-ink
                     transition-transform duration-200 ease-brand active:scale-[.97]"
        >
          שמירה
        </button>
      </div>
    </section>
  );
}

/** מגן — הבטחה של שמירה, לא של אבטחה. צורה אחת, בלי מנעול. */
function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
      <path
        d="M12 2.8 4.8 5.9v6c0 4.4 3 8.1 7.2 9.3 4.2-1.2 7.2-4.9 7.2-9.3v-6L12 2.8Z"
        stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"
      />
      <path d="m8.9 12.1 2.2 2.2 4-4.4" stroke="currentColor" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
