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

  /*
   * ═══════════════════════════════════════════════════════════════
   * ★★★ למה כל השורה היא כפתור — בשני המצבים ★★★
   * ═══════════════════════════════════════════════════════════════
   *
   * קודם רק האורח קיבל כפתור קטן בקצה ("כניסה · הרשמה"), והשם
   * והאווטאר שלידו לא היו לחיצים בכלל.
   *
   * זה נראה סביר ויוצר בעיה אמיתית: **אורח לא יכול להגיע
   * לפרופיל שלו.** הוא רואה את השם שלו על המסך, לוחץ עליו — ולא
   * קורה כלום. וזה בדיוק המשתמש שהכי צריך את המסך הזה, כי שם
   * יושב כרטיס המנוי שלו.
   *
   * ★ עכשיו: שורה אחת, לחיצה אחת, אותה התנהגות לכולם. מי שרואה
   *   את השם שלו יכול לגעת בו ולהגיע למקום שלו.
   */
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="פרופיל המאמן"
      className="tap -mx-1 flex min-w-0 flex-1 items-center gap-2.5 rounded-2xl px-1
                 text-start transition-colors active:bg-night-2/70"
    >
      <span
        className={`grid size-9 shrink-0 place-items-center rounded-full bg-night-2
                    text-[17px] ring-1 ring-inset ${
                      registered ? 'ring-gold/50' : 'ring-gold/25'}`}
      >
        {identity.avatar ? (
          <span aria-hidden="true">{identity.avatar}</span>
        ) : (
          <LogoMark size={26} />
        )}
      </span>

      <span className="min-w-0 flex-1 leading-tight">
        {/*
          ★★ שורת המצב אומרת **עובדה**, לא תווית ★★

          "רשום" הוא קטלוג. "מחובר עם גוגל" הוא משהו שהמשתמש יכול
          לאמת מול הזיכרון שלו — הוא באמת לחץ על גוגל לפני רגע.
          זה ההבדל בין מסך שטוען שהוא מחובר לבין מסך שמרגיש מחובר.

          ולאורח: "לא שמור" ולא "אורח". הראשון מתאר סיכון ומזמין
          לגעת; השני הוא סתם שם של קטגוריה.
        */}
        <span className="flex items-center gap-1.5">
          {registered ? (
            <>
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 rounded-full bg-emerald-400/80"
              />
              <span className="truncate text-[10px] font-bold tracking-[0.14em] text-chalk-dim">
                {providerLabel(identity.provider)}
              </span>
            </>
          ) : (
            <>
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 rounded-full bg-armband/80"
              />
              <span className="truncate text-[10px] font-bold tracking-[0.14em] text-armband/90">
                לא שמור · לחצו לשמירה
              </span>
            </>
          )}
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

/** "מחובר עם גוגל" / "מחובר במייל". `null` = מחובר, בלי לפרט. */
function providerLabel(provider: string | null | undefined): string {
  if (provider === 'google') return 'מחובר עם גוגל';
  if (provider === 'email') return 'מחובר במייל';
  return 'החשבון שמור';
}
