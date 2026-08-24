/**
 * components/Logo.tsx — הלוגו. מקום אחד שיודע איפה הקבצים.
 *
 * ★ למה קומפוננטה ולא `<img src="...">` בכל מסך
 *
 * הלוגו מופיע בשבעה מקומות בשלושה גדלים ובשני צבעים. בלי
 * קומפוננטה, החלפת נכס אחת הופכת לחיפוש־והחלפה על פני הקוד,
 * ותמיד נשאר מקום אחד עם הנכס הישן. כאן: שם אחד, וריאנט אחד,
 * וכל המוצר משתנה יחד.
 *
 * הנכסים עצמם נבנים מ-`brand/source/dubid-logo-source.png` על ידי
 * `scripts/design/build-logo.mjs`. אף אחד מהם אינו נערך ידנית.
 *
 * ★ `outline`
 *
 * הקו של הלוגו דק. מעל משטח אחיד הוא מצוין; מעל תמונה, גרדיאנט
 * או טקסטורת עץ הוא נבלע. `outline` מוסיף קו מתאר כהה של פיקסל
 * (ארבעה drop-shadow, ראו `.logo-outline` ב-index.css) שמחזיר
 * הפרדה בלי לצייר מסגרת סביב הלוגו.
 */

export type LogoVariant = 'gold' | 'cream' | 'ink';

interface Common {
  /** צבע הקו. `gold` על כהה, `ink` על נייר בהיר. */
  variant?: LogoVariant;
  /** קו מתאר כהה — למשטחים לא אחידים. */
  outline?: boolean;
  className?: string;
  /** ריק = דקורטיבי. הלוגו לרוב מלווה בטקסט, ואז אין מה להכריז. */
  alt?: string;
}

/** הלוגו המלא: דיוקן + חתימה + כדור. יחס 1:1. */
export function Logo({
  size = 120, variant = 'gold', outline = false, glow = false, className = '', alt = '',
}: Common & { size?: number; glow?: boolean }) {
  // מתחת ל-360px הגרסה הקטנה חוסכת 200kb ונראית זהה.
  const src = `/brand/dubid-logo-${variant}${size <= 360 ? '@360' : ''}.png`;
  return (
    <img
      src={src}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      width={size}
      height={size}
      decoding="async"
      className={[
        'block select-none',
        outline ? 'logo-outline' : '',
        glow ? 'logo-glow' : '',
        className,
      ].filter(Boolean).join(' ')}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * הסמל: הדיוקן בלבד, ריבועי.
 *
 * החתימה והכדור נעלמים מתחת ל-64px — הם קו של פחות מפיקסל.
 * הדיוקן שורד. לכן כל מקום צר (כותרת, אווטאר, תג) מקבל את זה
 * ולא את הלוגו המלא מוקטן.
 */
export function LogoMark({
  size = 40, variant = 'gold', outline = false, className = '', alt = '',
}: Common & { size?: number }) {
  return (
    <img
      src={`/brand/dubid-mark-${variant}.png`}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      width={size}
      height={size}
      decoding="async"
      className={['block shrink-0 select-none', outline ? 'logo-outline' : '', className]
        .filter(Boolean).join(' ')}
      style={{ width: size, height: size }}
    />
  );
}
