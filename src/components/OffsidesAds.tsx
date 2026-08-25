/**
 * components/OffsidesAds.tsx — יחידות הפרסום של אופסיידס.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ שלוש יחידות, כי יש שלושה סוגי רגעים
 * ═══════════════════════════════════════════════════════════════
 *
 *   OffsidesHero    כרזה. אחרי התוצאה, כשיש רגש ואין משימה.
 *   OffsidesInline  שורה בתוך טקסט. שם שהמשתמש כבר קורא.
 *   OffsidesRail    פס דק בתחתית. נוכחות, לא פנייה.
 *
 * (הרביעית, `OffsidesBanner`, קיימת בקובץ משלה — היא היחידה
 *  שנקשרת לרגע ספציפי דרך `pickPromo`.)
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ למה זה לא נראה כמו פרסומת שנקנתה
 * ═══════════════════════════════════════════════════════════════
 *
 * דוביד ואופסיידס הם אותה חברה. פרסומת שנראית כאילו רשת מדיה
 * הגישה אותה — מסגרת זרה, פונט אחר, "מודעה" בפינה — מזיקה
 * לשניהם: היא אומרת למשתמש שמישהו שילם כדי להגיע אליו.
 *
 * לכן: אותה טיפוגרפיה, אותו זהב, אותו קצה מוטבע. מה שמשתנה הוא
 * **החומר** — אופסיידס מביא כרום, נאון ודשא; דוביד הוא עץ, דיו
 * וזהב. שני עולמות שמכירים אחד את השני, לא שני מפרסמים.
 *
 * ★ הלוגו לא נצבע. אף פעם.
 *
 * הכרום והנאון שלו הם הזיהוי. גרסה מונוכרום בזהב הייתה
 * מתיישבת יפה יותר — ומלמדת את המשתמש לזהות סימן שלא קיים
 * באתר שאליו הוא לוחץ.
 */
import type { CSSProperties, ReactNode } from 'react';
import {
  INLINE_ADS, OFFSIDES, RAIL_COPY, offsidesUrl,
  type Placement, type PromoId,
} from '../lib/growth.ts';

/* ================================================================== */
/* משותף                                                               */
/* ================================================================== */

function href(placement: Placement, promo: PromoId, gw: number) {
  return offsidesUrl(promo, placement, gw);
}

/** `rel` מלא. `noopener` הוא אבטחה, לא נימוס: בלעדיו הדף הנפתח
 *  מקבל גישה ל-`window.opener` שלנו. */
const LINK_REL = 'noopener noreferrer';

/* ================================================================== */
/* 1 · הכרזה                                                           */
/* ================================================================== */

/**
 * ★ הרגע: המשתמש בדיוק ראה כמה נקודות עשה.
 *
 * הוא לא בונה כלום, לא מחליט כלום, ויש לו רגש טרי — ניצחון או
 * הפסד. זה הרגע היחיד במוצר שבו כרזה בגודל מלא היא לא הפרעה
 * אלא המשך טבעי. בכל מסך אחר היא הייתה חוסמת משימה.
 *
 * ★ הקומפוזיציה: אלומת זרקור אחת על דשא לילי, הלוגו במרכז
 *   הכובד, וכותרת אחת. אין שני מוקדים — עין שמתלבטת לא לוחצת.
 */
export function OffsidesHero({
  gameweekNumber, placement = 'result', promo = 'idle',
  headline, body, cta, onOpen, className = '',
}: {
  gameweekNumber: number;
  placement?: Placement;
  promo?: PromoId;
  headline?: string;
  body?: string;
  cta?: string;
  onOpen?: () => void;
  className?: string;
}) {
  return (
    <a
      href={href(placement, promo, gameweekNumber)}
      target="_blank"
      rel={LINK_REL}
      onClick={onOpen}
      aria-label={`${OFFSIDES.nameHe} — ${headline ?? OFFSIDES.name}`}
      className={`group relative block overflow-hidden rounded-3xl bg-night-2
                  transition-transform duration-200 ease-brand active:scale-[.99]
                  edge-gold ${className}`}
    >
      {/* ── דשא לילי ── */}
      <span
        aria-hidden
        className="absolute inset-0"
        style={{ background: 'linear-gradient(170deg,#0E2A1E 0%,#081410 55%,#0C0A08 100%)' }}
      />
      {/* פסי כיסוח — אותו מרקם של המגרש במסך ההרכב, כדי ששני
          המוצרים ירגישו כמו אותו עולם ולא כמו שתי מודעות */}
      <span
        aria-hidden
        className="absolute inset-0 opacity-[0.10]"
        style={{
          background:
            'repeating-linear-gradient(180deg, rgba(255,255,255,.9) 0 1px, transparent 1px 11%)',
        }}
      />
      {/* ── אלומת הזרקור. מקור אחד, פינה עליונה. ── */}
      <span
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 78% -10%, rgba(120,205,255,.30) 0%,' +
            ' rgba(120,205,255,.10) 30%, transparent 62%)',
        }}
      />
      {/* ── קו האור בקצה העליון ── */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-px"
        style={{ background: 'linear-gradient(90deg,transparent,#78CDFF,transparent)' }}
      />

      <span className="relative flex flex-col items-center px-5 pb-5 pt-6 text-center">
        <img
          src="/brand/offsides@160.png"
          alt=""
          aria-hidden
          width={112}
          height={109}
          decoding="async"
          className="drop-shadow-[0_10px_28px_rgba(120,205,255,.35)]
                     transition-transform duration-300 ease-brand group-hover:scale-[1.03]"
          style={{ width: 112, height: 'auto' }}
        />

        <span className="mt-3 block font-poster text-[22px] leading-[1.15] text-chalk">
          {headline ?? 'תשעים דקות. בלי לחכות לשבת.'}
        </span>
        <span className="mt-1.5 block max-w-[34ch] text-[12.5px] leading-snug text-chalk-2">
          {body ?? 'חיזוי משחקים חי וזירות מול חברים — על אותם משחקים שאתם כבר צופים בהם.'}
        </span>

        <span className="mt-4 inline-flex items-center gap-2 rounded-full
                         bg-gradient-to-b from-gold-light to-gold px-5 py-2.5
                         font-poster text-[15px] text-gold-ink">
          {cta ?? 'להיכנס לאופסיידס'}
          <Arrow />
        </span>

        <span className="num mt-2.5 block text-[9.5px] tracking-[0.18em] text-chalk-dim">
          {OFFSIDES.domainLabel}
        </span>
      </span>
    </a>
  );
}

/* ================================================================== */
/* 2 · שורה בתוך טקסט                                                  */
/* ================================================================== */

/**
 * ★ היחידה שתמשיך לעבוד בעוד חצי שנה.
 *
 * באנר נשחק. שורה שיושבת בתוך פסקה שהמשתמש קורא ממילא נקראת
 * כמידע, לא כפנייה — והיא עדיין עובדת בחשיפה החמישים.
 *
 * הכלל בכתיבה (`INLINE_ADS` ב-`growth.ts`): **המשפט חייב להיות
 * נכון גם בלי הקישור.** אם מוחקים את המילים המקושרות והמשפט
 * מתפרק — זו פרסומת שמתחזה למידע, והמשתמש ירגיש.
 *
 * ★ אין `dismiss`. אי אפשר לסגור משפט, ואין ממה להתגונן.
 */
export function OffsidesInline({
  placement, gameweekNumber, promo = 'idle', onOpen, className = '',
}: {
  placement: Placement;
  gameweekNumber: number;
  promo?: PromoId;
  onOpen?: () => void;
  className?: string;
}) {
  const copy = INLINE_ADS[placement];
  if (!copy) return null;

  return (
    <p className={`text-[12px] leading-relaxed text-chalk-dim ${className}`}>
      {copy.before}
      <a
        href={href(placement, promo, gameweekNumber)}
        target="_blank"
        rel={LINK_REL}
        onClick={onOpen}
        className="inline-flex items-baseline gap-1 font-black text-gold-light
                   underline decoration-gold/40 underline-offset-2
                   transition-colors hover:text-gold hover:decoration-gold"
      >
        {copy.link}
        <ExternalGlyph />
      </a>
      {copy.after}
    </p>
  );
}

/* ================================================================== */
/* 3 · הפס                                                             */
/* ================================================================== */

/**
 * ★ "גם שלנו" — שתי מילים שעושות את כל העבודה.
 *
 * הן מסגרות את אופסיידס כמוצר אחות ולא כמפרסם. ההבדל הזה הוא
 * ההבדל בין "החברה שבניתי לה חשבון מציעה לי עוד משהו" לבין
 * "מישהו קנה מקום במסך שלי", ורק הראשון נלחץ.
 *
 * בלי כפתור סגירה, בכוונה: פס של 44px שלא קוטע שום משימה לא
 * צריך הגנה, וכפתור × עליו רק היה מלמד שיש כאן משהו להתגונן ממנו.
 */
export function OffsidesRail({
  placement, gameweekNumber, promo = 'idle', onOpen, className = '',
}: {
  placement: Placement;
  gameweekNumber: number;
  promo?: PromoId;
  onOpen?: () => void;
  className?: string;
}) {
  return (
    <a
      href={href(placement, promo, gameweekNumber)}
      target="_blank"
      rel={LINK_REL}
      onClick={onOpen}
      className={`tap group flex items-center gap-2.5 rounded-2xl bg-night-2/70 px-3 py-2
                  ring-1 ring-inset ring-chalk/10 transition-colors duration-200
                  hover:ring-gold/30 ${className}`}
    >
      <span
        className="grid size-9 shrink-0 place-items-center rounded-lg bg-night"
        style={{ boxShadow: 'inset 0 0 0 1px rgba(120,205,255,.28)' } as CSSProperties}
      >
        <img
          src="/brand/offsides@160.png"
          alt=""
          aria-hidden
          width={26}
          height={25}
          decoding="async"
          style={{ width: 26, height: 'auto' }}
        />
      </span>

      <span className="min-w-0 flex-1 leading-tight">
        <span className="block text-[9px] font-black uppercase tracking-[0.2em] text-chalk-dim">
          {RAIL_COPY.label}
        </span>
        <span className="block truncate text-[12px] font-bold text-chalk-2">
          {RAIL_COPY.text}
        </span>
      </span>

      <span className="shrink-0 text-[11px] font-black text-gold-light">
        {OFFSIDES.nameHe}
      </span>
      <Arrow small />
    </a>
  );
}

/* ================================================================== */

function Arrow({ small = false }: { small?: boolean }) {
  // ב-RTL כיוון ההמשך הוא שמאלה. הצורה כתובה לכיוון הנכון ולא
  // מסובבת ב-transform, שהיה מתהפך שוב בדסקטופ LTR.
  const n = small ? 10 : 13;
  return (
    <svg viewBox="0 0 12 20" width={n} height={n * 1.5} aria-hidden="true"
         className="shrink-0 opacity-80">
      <path d="M9 2 3 10l6 8" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** חץ יציאה זעיר — אומר "נפתח באתר אחר" בלי מילים. */
function ExternalGlyph() {
  return (
    <svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true" className="shrink-0">
      <path d="M4.5 1.5H10.5V7.5" fill="none" stroke="currentColor"
            strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.5 1.5 5 7" fill="none" stroke="currentColor"
            strokeWidth="1.6" strokeLinecap="round" />
      <path d="M8.5 10.5h-7v-7" fill="none" stroke="currentColor"
            strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** עוטף לשימוש חוזר: כותרת קטנה מעל יחידת פרסום. */
export function AdLabel({ children }: { children: ReactNode }) {
  return (
    <span className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.22em] text-chalk-dim">
      {children}
    </span>
  );
}
