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
 *   · **הסימן.** דגל הקו של השופט, חתוך לצורה גאומטרית טהורה,
 *     עם שובל תנועה שהוא ה-💨 של אופסיידס בלי לצייר אמוג׳י.
 *     יצירה מקורית, לא העתק של שום סימן קיים.
 *
 * ═══════════════════════════════════════════════════════════════════
 *
 * מה הקומפוננטה הזו **לא** עושה: היא לא מחליטה מתי להופיע ולא מה
 * לומר. את זה עושה `lib/growth.ts`, שנבדק בלי דפדפן. כאן יש רק
 * ציור. הפרדה כזו היא מה שמאפשר לשנות מסר בלי לגעת בעיצוב.
 */
import type { CSSProperties } from 'react';
import { offsidesUrl, type Placement, type Promo, type PromoTone } from '../lib/growth.ts';

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
 * דגל הקו של שופט הקו, מופשט לשלוש צורות: מוט, משולש, ושובל.
 *
 * השובל הוא ה-💨 של אופסיידס — המטבע של המשחק — בלי לצייר אמוג׳י.
 * אמוג׳י בלוגו נראה כמו קיצור דרך; שלוש אלכסוניות שמתקצרות נראות
 * כמו החלטה. הצורה מקורית לחלוטין.
 */
function OffsidesMark({ glow }: { glow: string }) {
  return (
    <span
      className="grid size-14 shrink-0 place-items-center rounded-2xl bg-night"
      style={{ boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${glow} 40%, transparent)` }}
    >
      <svg viewBox="0 0 40 40" width="34" height="34" aria-hidden="true">
        {/* המוט */}
        <rect x="9" y="6" width="2.6" height="28" rx="1.3" fill="#C9C3B7" />
        {/* המשולש — קצה עליון חד, כמו דגל שהונף */}
        <path d="M12.6 7.5 L30 13.2 L12.6 18.9 Z" fill={glow} />
        {/* השובל — שלוש אלכסוניות שמתקצרות. תנועה, לא קישוט. */}
        <path
          d="M17 23.5 H31 M14.5 27.5 H27 M12.6 31.5 H22"
          stroke="#C9C3B7"
          strokeWidth="2"
          strokeLinecap="round"
          opacity=".5"
        />
      </svg>
    </span>
  );
}
