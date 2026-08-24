/**
 * components/Pitch.tsx — המגרש.
 *
 * ★ שלושת הבאגים שזה מתקן
 *
 *  1. **המגרש "ריחף".** גובהו נגזר מהתוכן, ולכן הוא קפץ בכל
 *     בחירה. עכשיו יש לו `aspect-ratio` קבוע — הוא תופס אותו
 *     מקום בדיוק, מלא או ריק.
 *
 *  2. **שחקנים עלו זה על זה.** הסידור היה רשת CSS שגלשה במסך צר.
 *     עכשיו כל שחקן ממוקם באחוזים לפי `layoutFormation`, ורוחב
 *     הכרטיס נגזר מהשורה הצפופה ביותר. אי-חפיפה היא אריתמטיקה
 *     ולא כיול — ויש לה בדיקה שרצה על כל מערך בכל רוחב.
 *
 *  3. **שחקנים לא היו בעמדות שלהם.** העמדה נקבעה לפי סדר במערך
 *     ולא לפי המערך הטקטי. עכשיו 4-3-3 מצייר ארבעה מגנים בקו
 *     ההגנה, ו-4-2-3-1 מצייר שתי שורות קישור.
 *
 * ★ רוחב הכרטיס ב-CSS ולא ב-JS
 *
 *   clamp(44px, calc(100% / maxRow - 6px), 76px)
 *
 * בלי ResizeObserver, בלי מדידה, בלי רינדור כפול. הדפדפן פותר
 * את זה בזמן layout — כולל בסיבוב מסך ובשינוי גודל חלון.
 */
import type { CSSProperties, ReactNode } from 'react';
import {
  GUTTER_PX, MAX_CARD, MIN_CARD,
  layoutFormation, ratioForFormation, verticalCap, type SlotPosition,
} from '../lib/formation.ts';
import type { Position } from '../lib/scoring/types.ts';

export interface PitchProps {
  formation: string;
  /** מרנדר את תוכן המשבצת. מקבל את מספר המשבצת (1-based). */
  renderSlot: (slotNo: number, position: Position, cardWidth: string) => ReactNode;
  /**
   * גובה חלקי רוחב. ברירת המחדל היא מגרש לאורך — ראו ההסבר
   * ב-`PITCH_RATIO`. אל תשנו ל"לרוחב" בלי לבדוק שחמש שורות נכנסות.
   */
  ratio?: number;
  /**
   * ★ מה קובע את גודל המגרש.
   *
   * `'width'`  — הרוחב נתון, הגובה נגזר. מתאים לדף שנגלל.
   * `'height'` — **הגובה נתון, הרוחב נגזר.** זה מה שמבטיח שרואים
   *              את כל המגרש בלי גלילה, וזו הדרישה במובייל:
   *              "המגרש קבוע, בלי תזוזה, שרואים את כולו".
   *
   * במצב `'height'` המגרש ממלא את גובה ההורה ומתמרכז אופקית.
   * `max-width: 100%` מגן על מסך צר במיוחד.
   */
  fit?: 'width' | 'height';
  className?: string;
}

export function Pitch({
  formation, renderSlot, ratio, fit = 'width', className = '',
}: PitchProps) {
  const layout = layoutFormation(formation);
  // יחס נגזר מהמערך אלא אם הקורא כפה אחד.
  const r = ratio ?? ratioForFormation(formation);

  if (!layout) {
    // מערך לא מוכר — לא מפילים את המסך ולא מנחשים פריסה.
    return (
      <div className="grid place-items-center rounded-3xl border border-chalk/10
                      bg-night-2 p-8 text-center text-sm text-chalk-dim">
        המערך {formation} אינו נתמך.
      </div>
    );
  }

  const style = (
    fit === 'height'
      ? {
          // גובה נתון → רוחב נגזר. המגרש נכנס במלואו, תמיד.
          height: '100%',
          width: 'auto',
          maxWidth: '100%',
          aspectRatio: `1 / ${r}`,
          '--max-row': String(layout.maxRow),
          '--vcap': verticalCap(r).toFixed(4),
        }
      : {
          width: '100%',
          aspectRatio: `1 / ${r}`,
          '--max-row': String(layout.maxRow),
          '--vcap': verticalCap(r).toFixed(4),
        }
  ) as CSSProperties;

  // ★ הביטוי היחיד שקובע גודל כרטיס — ותאום מדויק של `cardWidth()`.
  //   שני חסמים, בדיוק כמו בפונקציה: משבצת אופקית, ומרווח אנכי.
  //   `min()` מקנן בתוך `clamp()` כדי שהחסם החזק יותר ינצח.
  //
  //   אם שורה כאן משתנה, `cardWidth()` חייבת להשתנות איתה —
  //   יש בדיקה שמוודאת שהשתיים לא נפרדות.
  const byWidth = `calc(100% / var(--max-row) - ${GUTTER_PX}px)`;
  const byHeight = 'calc(100cqw * var(--vcap))';
  const card = `clamp(${MIN_CARD}px, min(${byWidth}, ${byHeight}), ${MAX_CARD}px)`;

  return (
    <div
      style={style}
      className={`relative overflow-hidden rounded-3xl [container-type:inline-size] ${className}`}
    >
      <PitchSurface />

      {layout.slots.map((slot, i) => (
        <PlayerSlot key={`${slot.position}-${slot.rowSize}-${slot.indexInRow}`} slot={slot} card={card}>
          {renderSlot(i + 1, slot.position, card)}
        </PlayerSlot>
      ))}
    </div>
  );
}

/**
 * משבצת בודדת. `translate(-50%,-50%)` ממרכז את הכרטיס על הנקודה,
 * כך שהמיקום באחוזים הוא מרכז הכרטיס ולא הפינה שלו — אחרת שורה
 * של ארבעה הייתה נוטה שמאלה.
 */
function PlayerSlot({
  slot, card, children,
}: { slot: SlotPosition; card: string; children: ReactNode }) {
  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ insetInlineStart: `${slot.x}%`, top: `${slot.y}%`, width: card }}
    >
      {children}
    </div>
  );
}

/* ================================================================== */
/* פני השטח                                                            */
/* ================================================================== */

/**
 * סימוני המגרש כ-SVG ולא כ-gradients.
 *
 * SVG נשאר חד בכל גודל ובכל צפיפות פיקסלים, והוא נמתח עם התיבה
 * בלי לחשב כלום. `preserveAspectRatio="none"` בכוונה: המגרש
 * שלנו לא בפרופורציות FIFA, והסימונים אמורים להימתח איתו.
 */
function PitchSurface() {
  return (
    <>
      {/* דשא — מעבר עומק מהמרכז לקצה */}
      <div
        className="absolute inset-0"
        aria-hidden="true"
        style={{ background: 'linear-gradient(180deg,#175E43 0%,#0E3527 100%)' }}
      />
      {/* פסי כיסוח. 9% לכל פס — מספיק דק כדי להיקרא כמרקם
          ומספיק עבה כדי לא ליצור moiré בהקטנה. */}
      <div
        className="absolute inset-0 opacity-[0.13]"
        aria-hidden="true"
        style={{
          background:
            'repeating-linear-gradient(180deg, rgba(255,255,255,.9) 0 1px, transparent 1px 9%)',
        }}
      />
      {/* ויניה — נותנת עומק ומרכזת את המבט על ההרכב */}
      <div
        className="absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            'radial-gradient(120% 80% at 50% 40%, transparent 40%, rgba(0,0,0,.45) 100%)',
        }}
      />

      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 122"
        preserveAspectRatio="none"
        aria-hidden="true"
        fill="none"
        stroke="rgba(255,255,255,0.28)"
        strokeWidth="0.45"
      >
        <rect x="3" y="3" width="94" height="116" rx="1" />
        <line x1="3" y1="61" x2="97" y2="61" />
        <circle cx="50" cy="61" r="13" />
        <circle cx="50" cy="61" r="0.9" fill="rgba(255,255,255,0.28)" stroke="none" />
        {/* רחבה תחתונה — צד השוער שלנו */}
        <rect x="24" y="99" width="52" height="20" />
        <rect x="38" y="112" width="24" height="7" />
        <path d="M36 99 A 15 15 0 0 0 64 99" />
        {/* רחבה עליונה */}
        <rect x="24" y="3" width="52" height="20" />
        <rect x="38" y="3" width="24" height="7" />
        <path d="M36 23 A 15 15 0 0 1 64 23" />
      </svg>
    </>
  );
}
