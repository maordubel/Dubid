/**
 * components/Shades.tsx — משקפי השמש. המוטיב הגרפי של דוביד.
 *
 * ★ למה דווקא המשקפיים
 *
 * לוגו של פרצוף לא עובד בכל גודל ולא בכל הקשר. משקפיים כן:
 * הן נקראות ב-16 פיקסלים באייקון, הן עובדות כקישוט בפינת כרטיס,
 * הן יכולות להיות מפריד בין סקשנים, והן מיד מזוהות עם הדמות.
 * זה ההבדל בין לוגו לבין **שפה** — וזה מה שנשאר איתנו עתידית.
 *
 * הגאומטריה כאן מקורית ומצוירת מחדש בסגנון wayfarer: עדשות
 * טרפזיות עם הטיה קלה כלפי חוץ, גשר נמוך, וקו גבה עבה שמחזיק
 * את כל הצורה. אותו משקל קו כמו שאר הקווים במותג.
 */

export interface ShadesProps {
  /** רוחב בפיקסלים. הגובה נגזר מהיחס. */
  size?: number;
  /** צבע המילוי. ברירת מחדל: currentColor — יורש מההקשר. */
  color?: string;
  /** ניצוץ אור על העדשה. כבו כשהמוטיב קטן מאוד. */
  glint?: boolean;
  className?: string;
  /** תיאור לקורא מסך. בלי זה המוטיב מוסתר כקישוט. */
  title?: string;
}

export function Shades({
  size = 96, color = 'currentColor', glint = true, className, title,
}: ShadesProps) {
  return (
    <svg
      viewBox="0 0 200 84"
      width={size}
      height={(size * 84) / 200}
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      fill="none"
    >
      {/* זרועות — עולות אחורה מקצות קו הגבה, כמו במקור */}
      <path
        d="M11 21 L1 14 M189 21 L199 14"
        stroke={color}
        strokeWidth="5"
        strokeLinecap="round"
      />

      {/* ★ עדשה שמאל — מלבן מעוגל ולא "כנף".
          זו הצורה שבלוגו: רוחב לגובה ~1.5, פינות מעוגלות בנדיבות,
          והפינה התחתונה־חיצונית העגולה ביותר. */}
      <path
        d="M20 20 H82 Q88 20 88 26 L88 52 Q88 68 72 69 L34 70
           Q18 70 15 56 L13 28 Q12 20 20 20 Z"
        fill={color}
      />

      {/* עדשה ימין — מראה סביב x=100 */}
      <path
        d="M180 20 H118 Q112 20 112 26 L112 52 Q112 68 128 69 L166 70
           Q182 70 185 56 L187 28 Q188 20 180 20 Z"
        fill={color}
      />

      {/* גשר האף — הפער בין העדשות הוא מה שהופך את הצורה לקריאה */}
      <path
        d="M89 29 Q100 20 111 29"
        stroke={color}
        strokeWidth="5.5"
        strokeLinecap="round"
      />

      {/* קו הגבה — חוצה את שתי העדשות וגולש מעט החוצה */}
      <path
        d="M8 19 Q100 13 192 19"
        stroke={color}
        strokeWidth="9"
        strokeLinecap="round"
      />

      {glint && (
        // ניצוץ — אלכסונים על שתי העדשות, כמו במקור.
        // הימנית מקבלת ניצוץ קטן יותר: האור מגיע משמאל.
        <g opacity="0.3">
          <path d="M26 34 L46 62" stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round" />
          <path d="M40 32 L52 48" stroke="#FFFFFF" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M124 34 L142 60" stroke="#FFFFFF" strokeWidth="5" strokeLinecap="round" />
        </g>
      )}
    </svg>
  );
}

/**
 * מפריד סקשנים — משקפיים קטנות בין שני קווים.
 * משמש כדי לתת קצב לעמוד בלי להוסיף עוד טקסט.
 */
export function ShadesDivider({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`} aria-hidden="true">
      <span className="h-px flex-1 bg-gradient-to-l from-chalk/20 to-transparent" />
      <Shades size={34} color="currentColor" glint={false} className="text-chalk/35" />
      <span className="h-px flex-1 bg-gradient-to-r from-chalk/20 to-transparent" />
    </div>
  );
}
