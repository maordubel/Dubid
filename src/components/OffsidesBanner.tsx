/**
 * OffsidesBanner.tsx — הפרסומת לאופסיידס.
 *
 * ═══════════════════════════════════════════════════════════════════
 *  "אור זרקורים" — הפילוסופיה החזותית
 * ═══════════════════════════════════════════════════════════════════
 *
 * אצטדיון בלילה הוא ניגוד אחד גדול: שדה כהה, ואלומה אחת שחותכת
 * אותו. כל השאר — הקהל, השלטים, הרעש — נמצא בחושך שמסביב, ורק מה
 * שהאור נוגע בו קיים. זו כל הקומפוזיציה כאן.
 *
 *   · **מרחב.** שדה כהה, אלומה אלכסונית אחת, ושום דבר שמתחרה בה.
 *     המסר יושב *בתוך* האור, לא לידו.
 *   · **טקסטורה.** רשת נקודות דקה — הדפס רשת של תוכנייה ישנה.
 *     היא נראית רק מקרוב, וזה בדיוק התפקיד שלה: לתת לעין משהו
 *     להישאר עליו אחרי שהמסר כבר נקרא.
 *   · **צבע.** צבע אחד לכל מצב, ולא יותר. אדום להפסד, זהב לניצחון,
 *     כתום לדחיפות, נייבי לשקט. הצבע הוא המסר לפני שקוראים מילה.
 *   · **טיפוגרפיה.** שורה אחת גדולה, שורה אחת קטנה, פועל אחד.
 *     אין פסקה. אם צריך פסקה — המסר לא מספיק חד.
 *   · **הסימן.** הלוגו האמיתי של אופסיידס — מד המהירות עם מחוג
 *     ומגרש. עד עכשיו היה כאן דגל קו מצויר, כי לא היה נכס.
 *     סימן ממציא הוא פשרה סבירה כשאין לוגו, והוא הופך למכשול
 *     ברגע שיש: הוא מלמד את המשתמש לזהות צורה שלא תופיע באתר
 *     שאליו הוא לוחץ.
 *
 * ═══════════════════════════════════════════════════════════════════
 *
 * מה הקומפוננטה הזו **לא** עושה: היא לא מחליטה מתי להופיע ולא מה
 * לומר. את זה עושה `lib/growth.ts`, שנבדק בלי דפדפן. כאן יש רק
 * ציור. הפרדה כזו היא מה שמאפשר לשנות מסר בלי לגעת בעיצוב.
 */
import type { CSSProperties } from 'react';
import { OFFSIDES, offsidesUrl, type Placement, type Promo, type PromoTone } from '../lib/growth.ts';

/** צבע אחד לכל טון. שני ערכים: האור, והדיו שיושב עליו. */
const TONE: Record<PromoTone, { glow: string; ink: string; label: string }> = {
  urgent:  { glow: '#FF5B14', ink: '#121110', label: 'חי עכשיו' },
  revenge: { glow: '#E4002B', ink: '#F6F3EB', label: 'ריוונג׳' },
  crown:   { glow: '#FFC93C', ink: '#121110', label: 'אלוף המחזור' },
  calm:    { glow: '#1F7FD1', ink: '#F6F3EB', label: 'אותו חשבון' },
};

export interface OffsidesBannerProps {
  promo: Promo;
  placement: Placement;
  gameweekNumber: number;
  /** נקרא כשהמשתמש סוגר. בלי זה אין × — באנר שאי אפשר לסגור הוא מלכודת. */
  onDismiss?: () => void;
  /** נקרא בלחיצה, לפני הניווט. לשיוך ואנליטיקס. */
  onOpen?: (promo: Promo) => void;
  className?: string;
}

export function OffsidesBanner({
  promo, placement, gameweekNumber, onDismiss, onOpen, className = '',
}: OffsidesBannerProps) {
  const tone = TONE[promo.tone];
  const href = offsidesUrl(promo.id, placement, gameweekNumber);

  return (
    <section
      aria-label="אופסיידס"
      className={`relative overflow-hidden rounded-3xl bg-night-2 ${className}`}
      style={{ '--glow': tone.glow } as CSSProperties}
    >
      {/* ── האור. אלומה אחת, אלכסונית, שנופלת מהפינה העליונה ── */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(118deg, color-mix(in srgb, var(--glow) 34%, transparent) 0%,' +
            ' color-mix(in srgb, var(--glow) 8%, transparent) 34%, transparent 62%)',
        }}
      />
      {/* ── הטקסטורה. רשת נקודות של הדפס ישן, כמעט מתחת לסף הראייה ── */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.14]"
        style={{
          backgroundImage: 'radial-gradient(currentColor 0.5px, transparent 0.5px)',
          backgroundSize: '7px 7px',
          color: tone.glow,
        }}
      />
      {/* ── קו האור בקצה. דק, והוא מה שהופך כרטיס לשלט ── */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${tone.glow}, transparent)` }}
      />

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="לא להציג שוב במחזור הזה"
          // `end-0` לוגי: ה-× יושב בצד ה"סוף" של הקריאה. אין כאן
          // transform, ולכן אין את באג המירכוז הלוגי.
          className="absolute end-0 top-0 z-10 grid size-11 place-items-center
                     text-lg text-chalk-dim transition-colors hover:text-chalk"
        >
          ×
        </button>
      )}

      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => onOpen?.(promo)}
        className="tap relative flex items-center gap-3.5 px-4 py-4 text-start
                   transition-transform duration-200 ease-brand active:scale-[.99]"
      >
        <OffsidesMark glow={tone.glow} />

        <span className="min-w-0 flex-1">
          <span
            className="inline-block rounded-full px-2 py-0.5 text-[9px] font-black
                       uppercase tracking-[0.18em]"
            style={{ background: tone.glow, color: tone.ink }}
          >
            {tone.label}
          </span>

          <span className="mt-1.5 block font-display text-[15px] font-black
                           leading-tight text-chalk">
            {promo.headline}
          </span>
          <span className="mt-0.5 block text-[11.5px] leading-snug text-chalk-2">
            {promo.body}
          </span>

          <span
            className="mt-2 inline-flex items-center gap-1 text-[12px] font-black"
            style={{ color: tone.glow }}
          >
            {promo.cta}
            {/* החץ פונה שמאלה — כיוון ההמשך ב-RTL. */}
            <span aria-hidden>←</span>
          </span>
        </span>
      </a>
    </section>
  );
}

/* ================================================================== */
/* הסימן                                                               */
/* ================================================================== */

/**
 * הלוגו של אופסיידס, על ריבוע כהה.
 *
 * ★ למה ריבוע כהה מתחת ללוגו שכבר שקוף
 *
 * המילה "OFFSIDES" בלוגו לבנה עם קו מתאר בהיר. על רקע כהה היא
 * מצוינת; על משטח שהוארו על ידי הזוהר של הטון (זהב, כתום) היא
 * מאבדת ניגוד ונראית כמו כתם. הריבוע מבודד אותה מהאלומה.
 *
 * הטבעת מקבלת את צבע הטון, ולכן הסימן משתתף במצב הרגשי של
 * הבאנר בלי שהלוגו עצמו ייצבע — צביעת לוגו של מוצר אחר היא
 * בדיוק מה שאסור לעשות.
 */
function OffsidesMark({ glow }: { glow: string }) {
  return (
    <span
      className="grid size-14 shrink-0 place-items-center rounded-2xl bg-night"
      style={{ boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${glow} 40%, transparent)` }}
    >
      <img
        src="/brand/offsides@160.png"
        alt={OFFSIDES.name}
        width={42}
        height={41}
        decoding="async"
        className="object-contain"
        style={{ width: 42, height: 'auto' }}
      />
    </span>
  );
}
