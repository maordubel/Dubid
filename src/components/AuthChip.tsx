/**
 * components/AuthChip.tsx — הכניסה לחשבון, בכפתור אחד.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ הבעיה שהיה צריך לפתור
 * ═══════════════════════════════════════════════════════════════
 *
 * למוצר לא הייתה שום נקודת כניסה גלויה לחשבון. שורת הזהות
 * בלובי הייתה כפתור — אבל היא נראתה כמו טקסט, ולכן אף אחד לא
 * לחץ עליה. אורח לא ידע שאפשר להירשם, ומשתמש רשום לא ידע איך
 * לצאת.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ למה כפתור אחד ולא שניים
 * ═══════════════════════════════════════════════════════════════
 *
 * "היכנס" ו-"הירשם" הם אותה כוונה עם שני שמות. מי שיש לו חשבון
 * ומי שאין לו לוחצים על אותו מקום, ורק המסך שנפתח יודע להבדיל.
 * שני כפתורים צמודים היו מכריחים כל משתמש לענות על שאלה שהמערכת
 * יכולה לענות עליה בעצמה.
 *
 * ולכן: **כפתור אחד, שלושה מצבים.**
 *
 *   טוען      →  שלד. לא "אורח" — מצב ביניים שקורא לך בשם הלא
 *                נכון גרוע ממצב ביניים שקטן ושותק.
 *   אורח      →  "כניסה · הרשמה". קריאה לפעולה, לא מידע.
 *   רשום      →  השם והאווטאר. הפעולה היא לפתוח את הפרופיל,
 *                והיציאה יושבת שם — לא בלובי.
 *
 * ★ למה "צא מהפרופיל" לא יושב כאן
 *
 * זו פעולה הרסנית (היא מנתקת מהזהות), והיא לא צריכה להיות
 * במרחק לחיצה אחת מהמסך הראשי. היא נמצאת בתוך גיליון החשבון,
 * אחרי שהמשתמש כבר שם ורואה מה יש לו.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ הפסיכולוגיה של הכיתוב, בשתי שורות
 * ═══════════════════════════════════════════════════════════════
 *
 * · לאורח לא כתוב "אורח" בגדול. תווית שמסמנת נחיתות גורמת
 *   לאנשים לעזוב, לא להירשם. הוא **מאמן**, כמו כולם.
 * · לא כתוב "שמור את ההתקדמות שלך" — זו הבטחה מרומזת שמשהו
 *   יאבד, והיא לא נכונה: ההגשות של אורח שמורות בשרת בדיוק כמו
 *   של כולם. שקר קטן בממשק הוא חוב שמשלמים עליו באמון.
 */

import type { Identity } from '../lib/identity.ts';
import { LogoMark } from './Logo.tsx';

export interface AuthChipProps {
  /** `null` = הזהות עוד לא נטענה. */
  identity: Identity | null;
  /** נפתח גיליון החשבון — גם לכניסה וגם לפרופיל. */
  onOpen: () => void;
}

export function AuthChip({ identity, onOpen }: AuthChipProps) {
  /* ---- טוען ---- */
  if (!identity) {
    return (
      <div
        className="flex min-w-0 flex-1 items-center gap-2.5 px-1"
        aria-hidden="true"
      >
        <span className="size-9 shrink-0 animate-pulse rounded-full bg-night-2" />
        <span className="h-3.5 w-24 animate-pulse rounded bg-night-2" />
      </div>
    );
  }

  const registered = !identity.isGuest || !!identity.offsidesUserId;
  const name = identity.displayName?.trim();

  /* ---- אורח ---- */
  if (!registered) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="grid size-9 shrink-0 place-items-center rounded-full
                         bg-night-2 ring-1 ring-inset ring-gold/25">
          <LogoMark size={26} />
        </span>

        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-chalk-dim">
            מאמן
          </span>
          <span className="block truncate text-[15px] font-black text-chalk">
            {name || 'אורח'}
          </span>
        </span>

        {/* ★ הכפתור עצמו — קטן, זהוב, ובקצה. הוא לא מתחרה עם
            השעון או עם כרטיסי המשחק; הוא פשוט קיים ונראה לחיץ. */}
        <button
          type="button"
          onClick={onOpen}
          className="tap shrink-0 rounded-full border border-gold/40 bg-gold/10 px-3
                     py-1.5 text-[11.5px] font-black leading-none text-gold-light
                     transition-colors active:bg-gold/20"
        >
          כניסה · הרשמה
        </button>
      </div>
    );
  }

  /* ---- רשום ---- */
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="הפרופיל שלי"
      className="tap -mx-1 flex min-w-0 flex-1 items-center gap-2.5 rounded-2xl px-1
                 text-start transition-colors active:bg-night-2/70"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-full
                       bg-night-2 text-[17px] ring-1 ring-inset ring-gold/40">
        {identity.avatar ? (
          <span aria-hidden="true">{identity.avatar}</span>
        ) : (
          <LogoMark size={26} />
        )}
      </span>

      <span className="min-w-0 flex-1 leading-tight">
        <span className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-chalk-dim">
            מאמן
          </span>
          {/* ★ הנקודה הירוקה היא הדבר היחיד שמסמן "אתה בפנים".
              תג "רשום" היה מקטלג אנשים; נקודה פשוט מרגיעה. */}
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-emerald-400/80"
          />
        </span>
        <span className="block truncate text-[15px] font-black text-chalk">
          {name || identity.username || 'מאמן'}
        </span>
      </span>

      <span aria-hidden="true" className="shrink-0 text-[16px] leading-none text-chalk-dim">
        ‹
      </span>
    </button>
  );
}
