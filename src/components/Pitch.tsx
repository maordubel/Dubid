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
import { PRESS } from '../lib/pressPalette.ts';

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
  /** צבע המצב. פס דק בקצה העליון — זהות בלי רעש. */
  accent?: string;
  /**
   * שוליים של נייר סביב הדשא.
   *
   * ★ למה `box-shadow` ולא `border` או `padding`
   *
   * המגרש ממוקם ב-`fit="height"`: הגובה נתון והרוחב נגזר מיחס
   * הצדדים. `border` או `padding` היו נכנסים לחישוב הזה ומקטינים
   * את הדשא בכל צד — כלומר משנים את הפריסה של השחקנים. צל חיצוני
   * לא תופס מקום בכלל.
   */
  frameColor?: string;
  /**
   * תוכן שמרחף **בתוך** קופסת המגרש.
   *
   * ★ למה לא פשוט `absolute` באב.
   *
   * המגרש ב-`fit="height"` הוא `width:auto` וממורכז — כלומר
   * רוחבו קטן מרוחב האב. אלמנט שמוצב `absolute` באב היה נצמד
   * לקצה **המסך**, ובמסך רחב הוא היה מרחף באוויר במרחק מהמגרש.
   *
   * וגם: לקופסה הזו יש `container-type: inline-size`, ולכן ילד
   * שלה יכול למדוד את עצמו ב-`cqw` — כלומר ביחס לרוחב המגרש.
   * זה מה שמאפשר לחלון התקציב להתכווץ עם המגרש במקום לגלוש
   * על השחקנים במסך צר.
   */
  overlay?: ReactNode;
  className?: string;
}

export function Pitch({
  formation, renderSlot, ratio, fit = 'width', accent, frameColor,
  overlay, className = '',
}: PitchProps) {
  const layout = layoutFormation(formation);
  // יחס נגזר מהמערך אלא אם הקורא כפה אחד.
  const r = ratio ?? ratioForFormation(formation);

  if (!layout) {
    // מערך לא מוכר — לא מפילים את המסך ולא מנחשים פריסה.
    return (
      <div className="grid place-items-center rounded-3xl border border-gold/15
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
          ...(frameColor
            ? { boxShadow: `0 0 0 5px ${frameColor}, 0 12px 34px -16px rgba(0,0,0,.85)` }
            : null),
        }
      : {
          width: '100%',
          aspectRatio: `1 / ${r}`,
          '--max-row': String(layout.maxRow),
          '--vcap': verticalCap(r).toFixed(4),
          ...(frameColor
            ? { boxShadow: `0 0 0 5px ${frameColor}, 0 12px 34px -16px rgba(0,0,0,.85)` }
            : null),
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
      className={`relative overflow-hidden rounded-lg [container-type:inline-size] ${className}`}
    >
      <PitchSurface accent={accent} />

      {layout.slots.map((slot, i) => (
        <PlayerSlot key={`${slot.position}-${slot.rowSize}-${slot.indexInRow}`} slot={slot} card={card}>
          {renderSlot(i + 1, slot.position, card)}
        </PlayerSlot>
      ))}

      {overlay}
    </div>
  );
}

/**
 * משבצת בודדת.
 *
 * ★★ `left` ולא `inset-inline-start` — וזה לא קפריזה. ★★
 *
 * באג אמיתי שהיה כאן: ב-RTL, `insetInlineStart` עוגן את הכרטיס
 * מהצד **הימני**, בעוד `translateX(-50%)` הזיז אותו **שמאלה**.
 * השניים לא ביטלו זה את זה — כל כרטיס ישב במרחק של רוחב כרטיס
 * שלם מהמקום שלו. על המגרש זה נראה בדיוק כמו "שחקנים שלא
 * נמצאים בעמדות שלהם".
 *
 * `slot.x` הוא קואורדינטה **גאומטרית** על המגרש (0 = הקצה
 * השמאלי), לא "תחילת הטקסט". גאומטריה לא מתהפכת עם שפת הממשק,
 * ולכן המאפיין הנכון הוא הפיזי. `left` + `translateX(-50%)`
 * ממרכזים את הכרטיס על הנקודה, זהה לחלוטין ב-RTL וב-LTR.
 *
 * המגרש סימטרי, ולכן אין בזה שום פגיעה ב-RTL של המוצר.
 */
function PlayerSlot({
  slot, card, children,
}: { slot: SlotPosition; card: string; children: ReactNode }) {
  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: card }}
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
function PitchSurface({ accent }: { accent?: string }) {
  return (
    <>
      {/* דשא מודפס — צבע שטוח, לא גרדיאנט. דפוס לא יודע לדהות. */}
      <div className="absolute inset-0" aria-hidden="true" style={{ background: PRESS.grass }} />

      {/* ★ פסי כיסוח רחבים ושטוחים, בדיוק כמו בכרטיס.
          קודם היו כאן פסים של 1px ב-9% — מרקם, לא כיסוח. בגודל
          מסך טלפון הם יצרו moiré ונראו כמו רעש. */}
      <div
        className="absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            `repeating-linear-gradient(180deg, ${PRESS.grassDark} 0 14.2857%, transparent 14.2857% 28.5714%)`,
        }}
      />

      {/* ★ נקודות הדפוס — זה מה שהופך ירוק ל"ירוק מודפס".
          שתי שכבות בהיסט חצי־צעד = רשת משורגת, כמו הלפטון אמיתי,
          בלי קנבס ובלי תמונה. */}
      <div
        className="absolute inset-0"
        aria-hidden="true"
        style={{
          backgroundImage:
            `radial-gradient(${PRESS.dot} 0.9px, transparent 1px),` +
            `radial-gradient(${PRESS.dot} 0.9px, transparent 1px)`,
          backgroundSize: '7px 7px, 7px 7px',
          backgroundPosition: '0 0, 3.5px 3.5px',
          opacity: 0.34,
        }}
      />

      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 122"
        preserveAspectRatio="none"
        aria-hidden="true"
        fill="none"
      >
        {/* ---- השער בפרספקטיבה, בקצה העליון ----
            ★ הוא מה שאומר "לאיזה כיוון מותקפים" בלי מילה אחת.
               הרשת שקופה למחצה כדי שלא תיקרא כמלבן לבן. */}
        <g>
          <path d="M31 3 L35 -2 L65 -2 L69 3 Z" fill={PRESS.net} />
          <g stroke={PRESS.netLine} strokeWidth="0.22">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <line key={i}
                x1={31 + (38 * i) / 9} y1="3"
                x2={35 + (30 * i) / 9} y2="-2" />
            ))}
            <line x1="32.3" y1="1.3" x2="67.7" y2="1.3" />
            <line x1="33.7" y1="-0.4" x2="66.3" y2="-0.4" />
          </g>
          <path d="M31 3 L35 -2 L65 -2 L69 3"
                stroke={PRESS.ink} strokeWidth="0.8" strokeLinejoin="miter" />
        </g>

        {/* ---- סימוני המגרש ---- */}
        <g stroke={PRESS.line} strokeWidth="0.62" strokeLinejoin="miter">
          <rect x="2.6" y="2.6" width="94.8" height="116.8" />
          <line x1="2.6" y1="61" x2="97.4" y2="61" />
          <circle cx="50" cy="61" r="13" />
          {/* רחבה עליונה — שער היריב */}
          <rect x="24" y="2.6" width="52" height="20" />
          <rect x="38" y="2.6" width="24" height="7" />
          <path d="M36 22.6 A 15 15 0 0 1 64 22.6" />
          {/* רחבה תחתונה — הצד שלנו */}
          <rect x="24" y="99.4" width="52" height="20" />
          <rect x="38" y="112.4" width="24" height="7" />
          <path d="M36 99.4 A 15 15 0 0 0 64 99.4" />
        </g>
        <circle cx="50" cy="61" r="0.9" fill={PRESS.line} />
      </svg>

      {/* ★ קיילין הדיו — הדשא נגמר בקו, לא בשפה מטושטשת.
          זה הפרט הקטן שהופך "אזור ירוק" ל"מגרש מודפס". */}
      <div
        className="pointer-events-none absolute inset-0 rounded-[inherit]"
        aria-hidden="true"
        style={{ boxShadow: `inset 0 0 0 3px ${PRESS.ink}` }}
      />

      {/* ★ זהות המצב, בפינה. פס דק בצבע המצב — מספיק כדי
          ששני צילומי מסך ייקראו כשני משחקים, ולא מספיק כדי
          להתחרות בהרכב עצמו. */}
      {accent && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[3px]"
          aria-hidden="true"
          style={{ background: accent }}
        />
      )}
    </>
  );
}
