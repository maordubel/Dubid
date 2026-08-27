/**
 * components/BrandDraw.tsx — הלוגו מצייר את עצמו.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ מה זה
 * ═══════════════════════════════════════════════════════════════
 *
 * שלוש שכבות של אותו לוגו, שנחשפות לפי סדר הציור:
 *
 *     1. הטבעת והדיוקן — חשיפה מעגלית, עם ציפורן שנוסעת על הקו
 *     2. החתימה Dubid  — מגב אופקי, כמו כתיבת יד
 *     3. הכדור והקווים — חותמת בסוף
 *
 * כל התזמון והתנועה יושבים ב-CSS (`styles/index.css`). הקומפוננטה
 * הזו לא מנפישה כלום — היא רק מרכיבה, נותנת משכים, ומודיעה כשנגמר.
 *
 * ★ למה זה לא מכביד
 *
 * `mask-image` ו-`transform` בלבד. אפס JavaScript בלולאה, אפס
 * ציור מחדש, אפס layout. שלוש תמונות שכבר במטמון של הדפדפן.
 *
 * ★ ולמה בכל זאת יש כאן טיימר
 *
 * מישהו צריך לדעת מתי הציור נגמר כדי להמשיך הלאה — ומאזין
 * `animationend` על אנימציה שעשויה בכלל לא לרוץ (העדפת תנועה
 * מופחתת, `@property` חסר) הוא הבטחה שלא תמומש. טיימר אחד,
 * ודאי, ומתנקה.
 */
import { useEffect, useRef } from 'react';

import type { LogoVariant } from './Logo.tsx';

/**
 * ★ שני קצבים, ולא פרמטר חופשי.
 *
 * `intro` הוא הכניסה לאפליקציה — שם מותר לקחת שנייה וחצי, כי
 * המשתמש בדיוק הגיע ואין לו מה לעשות בינתיים.
 *
 * `swipe` הוא מעבר בין מסכים — שם כל מילישנייה מעל 600 היא
 * מישהו שמחכה. אותה תנועה, מהודקת.
 *
 * משכים חופשיים היו מייצרים עשר מהירויות שונות במוצר אחד.
 */
export type DrawPace = 'intro' | 'swipe';

const PACE: Record<DrawPace, { l1: number; l2: number; l3: number }> = {
  intro: { l1: 900, l2: 520, l3: 320 },
  swipe: { l1: 420, l2: 240, l3: 180 },
};

/** כמה זמן הציור נמשך בפועל — כולל החפיפות שב-CSS. */
export function drawDuration(pace: DrawPace, startDelay = 0): number {
  const p = PACE[pace];
  // החפיפות (‎-160 ו-‎-220) זהות למה שב-CSS. מקום אחד לשנות, ואם
  // משנים שם — לשנות גם כאן, אחרת ה-`onDone` יקדים או יאחר.
  return startDelay + p.l1 - 160 + p.l2 - 220 + p.l3;
}

export interface BrandDrawProps {
  size?: number;
  variant?: LogoVariant;
  pace?: DrawPace;
  /** השהיה לפני שהציור מתחיל. */
  delay?: number;
  /** נקרא כשהציור הסתיים. תמיד נקרא, גם בלי אנימציה. */
  onDone?: () => void;
  className?: string;
  /** ריק = דקורטיבי. הלוגו כמעט תמיד מלווה בטקסט. */
  alt?: string;
}

export function BrandDraw({
  size = 200,
  variant = 'gold',
  pace = 'intro',
  delay = 0,
  onDone,
  className = '',
  alt = '',
}: BrandDrawProps) {
  const p = PACE[pace];

  /* ★ `onDone` ב-ref ולא בתלויות.
     הורה שמעביר פונקציה חדשה בכל רינדור היה מאפס את הטיימר
     בכל רינדור — כלומר ציור שלעולם לא נגמר. */
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (!done.current) return;
    const ms = drawDuration(pace, delay);
    const t = setTimeout(() => done.current?.(), ms);
    return () => clearTimeout(t);
  }, [pace, delay]);

  const src = (layer: 'l1' | 'l2' | 'l3') => `/brand/dubid-logo-${variant}-${layer}.png`;

  return (
    <div
      className={`draw-stage ${className}`}
      style={{
        width: size,
        height: size,
        // המשכים עוברים כמשתני CSS — כך ה-CSS מחזיק את התנועה
        // וה-TypeScript מחזיק רק מספרים.
        ['--draw-start' as string]: `${delay}ms`,
        ['--draw-1' as string]: `${p.l1}ms`,
        ['--draw-2' as string]: `${p.l2}ms`,
        ['--draw-3' as string]: `${p.l3}ms`,
      }}
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
    >
      {/* ★ `fetchPriority="high"` על השכבה הראשונה בלבד.
          היא זו שנראית ראשונה; השתיים האחרות מקבלות 700ms קדימה
          לרדת ברקע, ולכן אין טעם להתחרות איתה על הרוחב פס. */}
      <img className="draw-l1" src={src('l1')} alt="" aria-hidden="true"
           width={size} height={size} decoding="async" fetchPriority="high" />
      <div className="draw-nib" aria-hidden="true" />
      <img className="draw-l2" src={src('l2')} alt="" aria-hidden="true"
           width={size} height={size} decoding="async" />
      <img className="draw-l3" src={src('l3')} alt="" aria-hidden="true"
           width={size} height={size} decoding="async" />
    </div>
  );
}
