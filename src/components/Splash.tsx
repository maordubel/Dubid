/**
 * components/Splash.tsx — כרטיס הפתיחה.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ למה מסך פתיחה בכלל, כשהכלל הוא "מהר להיכנס"
 * ═══════════════════════════════════════════════════════════════
 *
 * כי הוא לא עולה זמן. הוא **תופס** זמן שממילא עובר.
 *
 * בעלייה קרה האפליקציה עושה שלושה דברים לפני שיש מה להראות:
 * יוצרת זהות, מושכת את הליגה, ומושכת את ההגשות. זה בין חצי
 * שנייה לשתיים, תלוי ברשת. בלי מסך פתיחה המשתמש רואה בזמן הזה
 * שלד ריק או לובי מהבהב.
 *
 * ★ ולכן החוק כאן: המסך נעלם ברגע שהנתונים מוכנים — ולא שנייה
 *   אחריו. הוא ממתין להשלמת הציור רק כי חצי לוגו שנעלם נראה
 *   כמו תקלה, ולא כי הוא רוצה את תשומת הלב.
 *
 * ★ תקרה קשיחה
 *
 * גם אם השרת לא ענה, המסך יורד. אפליקציה שנתקעת על מסך פתיחה
 * היא אפליקציה שבורה — עדיף לובי שאומר "לא מחובר" ממסך יפה
 * שלא זז.
 */
import { useEffect, useState } from 'react';

import { BrandDraw, drawDuration } from './BrandDraw.tsx';

/** אחרי זה יורדים, מוכן או לא. */
const HARD_CEILING_MS = 3200;

/** משך הדהייה החוצה. חייב להתאים ל-`duration-500` שלמטה. */
const FADE_MS = 460;

export interface SplashProps {
  /** `true` = הנתונים הגיעו. המסך יורד ברגע שגם הציור נגמר. */
  ready: boolean;
  onDone: () => void;
  seasonLabel?: string;
}

export function Splash({ ready, onDone, seasonLabel = 'ליגת העל 2026/27' }: SplashProps) {
  const [drawn, setDrawn] = useState(false);
  const [leaving, setLeaving] = useState(false);

  /* תקרה: יורדים בכל מקרה. */
  useEffect(() => {
    const t = setTimeout(() => setLeaving(true), HARD_CEILING_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (drawn && ready) setLeaving(true);
  }, [drawn, ready]);

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(onDone, FADE_MS);
    return () => clearTimeout(t);
    // `onDone` מכוון להיות יציב; הורה שמשנה אותו בכל רינדור היה
    // מאפס את היציאה. ראו את אותו טיפול ב-`BrandDraw`.
  }, [leaving]);

  return (
    <div
      dir="rtl"
      aria-hidden={leaving}
      className={`tex-wood fixed inset-0 z-[100] grid place-items-center
                  transition-opacity duration-500 ease-brand
                  ${leaving ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
    >
      {/* ★ אור אצטדיון. גרדיאנט אחד, לא תמונה.
          הוא מה שהופך רקע שחור ל"מגרש בלילה" — והוא גם מה
          שנותן ללוגו על מה לשבת בלי מסגרת. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(78% 52% at 50% 34%, rgba(216,178,92,.13), transparent 70%)',
        }}
      />

      <div className="relative flex flex-col items-center gap-5 px-8">
        <BrandDraw
          size={224}
          variant="gold"
          pace="intro"
          delay={120}
          onDone={() => setDrawn(true)}
          alt="דוביד שווייצר"
        />

        {/* ★ הכיתוב נכנס **אחרי** שהיד הניחה את העט.
            טקסט שמופיע תוך כדי ציור גונב את המבט מהדבר היחיד
            שהמסך הזה קיים בשבילו. */}
        <p
          className="font-poster text-[11px] tracking-[0.42em] text-gold-light/70"
          style={{
            animation: `dubid-stamp 420ms cubic-bezier(.2,.9,.3,1) both`,
            animationDelay: `${drawDuration('intro', 120)}ms`,
          }}
        >
          {seasonLabel}
        </p>

        {/* ★ החוט הדק. מופיע רק אם הרשת איטית — כלומר בדיוק
            כשהמשתמש מתחיל לתהות אם משהו תקוע. */}
        <div
          aria-hidden="true"
          className={`h-px w-24 origin-center bg-gradient-to-l from-transparent
                      via-gold/50 to-transparent transition-opacity duration-500
                      ${drawn && !ready ? 'animate-pulse opacity-100' : 'opacity-0'}`}
        />
      </div>
    </div>
  );
}
