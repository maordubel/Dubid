/**
 * DubelCredit.tsx — הקרדיט לדובל טים.
 *
 * ★ למה זה קומפוננטה ולא שורת טקסט
 *
 * הקרדיט מופיע בכמה מסכים. שורה מודבקת בכל אחד מהם נשברת ביום
 * שבו הכתובת משתנה. כאן יש מקור אחד, והכתובת יוצאת ממנו.
 *
 * ★ הסימן
 *
 * הלוגו האמיתי (הכלב עם הכתר) יושב ב-`/brand/dubel-team.png`.
 * הוא **עגול במקור** — עיגול אדום-שחור עם רקע קרם בפנים — ולכן
 * הוא מוצג בלי מסגרת ובלי `rounded-full` נוסף: עיגול על עיגול
 * חותך את הקצה של הציור.
 *
 * הכתר המצויר בקו נשאר כנפילה חיננית, למקרה שהקובץ לא נטען.
 * שחזור לוגו מהזיכרון תמיד יוצא "כמעט", ו"כמעט" נראה גרוע
 * מסימן פשוט שנבחר במכוון — ולכן הנפילה היא צורה אחרת לגמרי
 * ולא חיקוי.
 */
import { useState } from 'react';
import { DUBEL } from '../lib/growth.ts';

/** שם היסטורי. המקור הוא `DUBEL.site` ב-`lib/growth.ts`. */
export const DUBEL_URL = DUBEL.site;

export interface DubelCreditProps {
  /** 'quiet' — שורה בתחתית מסך. 'card' — כרטיס עם נוכחות. */
  variant?: 'quiet' | 'card';
  className?: string;
}

export function DubelCredit({ variant = 'quiet', className = '' }: DubelCreditProps) {
  if (variant === 'card') {
    return (
      <a
        href={DUBEL_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={`tap flex items-center gap-3 rounded-2xl border border-gold/15
                    bg-night-2 px-4 py-3 transition-colors duration-200 ease-brand
                    hover:border-armband/30 ${className}`}
      >
        <DubelMark size={34} />
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] uppercase tracking-[0.2em] text-chalk-dim">
            נבנה על ידי
          </span>
          <span className="block font-display text-sm font-black text-chalk">
            DUBEL TEAM
          </span>
        </span>
        <span aria-hidden className="text-chalk-dim">←</span>
      </a>
    );
  }

  return (
    <p className={`flex items-center justify-center gap-2 text-[11px] text-chalk-dim ${className}`}>
      <DubelMark size={18} />
      <span>
        נבנה על ידי{' '}
        <a
          href={DUBEL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-black text-chalk-2 underline decoration-armband/50
                     underline-offset-2 hover:text-chalk"
        >
          Dubel Team
        </a>
      </span>
    </p>
  );
}

/**
 * הסימן: התמונה אם היא קיימת, אחרת כתר בקו.
 * `onError` ולא בדיקה מראש — אין דרך לשאול את הדפדפן "האם הקובץ
 * קיים" בלי לבקש אותו בכל מקרה.
 */
function DubelMark({ size }: { size: number }) {
  const [failed, setFailed] = useState(false);

  if (!failed) {
    return (
      <img
        // מתחת ל-64px הגרסה הקטנה חוסכת 100kb ונראית זהה.
        src={size <= 64 ? '/brand/dubel-team@64.png' : '/brand/dubel-team@128.png'}
        alt=""
        width={size}
        height={size}
        decoding="async"
        onError={() => setFailed(true)}
        className="shrink-0 object-contain"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"
      className="shrink-0"
    >
      <circle cx="12" cy="12" r="11" fill="none" stroke="#C8332F" strokeWidth="1.5" />
      <path
        d="M6.5 15.5 L6.5 9 L9.25 11.5 L12 8 L14.75 11.5 L17.5 9 L17.5 15.5 Z"
        fill="none"
        stroke="#FFC93C"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
