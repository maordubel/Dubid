/**
 * components/Footballer.tsx — הדמות המצוירת, ב-SVG.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ למה זה קיים
 * ═══════════════════════════════════════════════════════════════
 *
 * הדמות הזו כבר קיימת פעמיים: בקנבס של כרטיס השיתוף
 * (`lib/revealCard.ts`) ובאיור של הלובי. עכשיו היא נדרשת גם על
 * המגרש בבחירת ההרכב — ובשלושתם היא חייבת להיראות **אותו דבר**,
 * אחרת מי שבנה הרכב וקיבל גזיר עיתון רואה שני ציירים.
 *
 * שלושת המנועים שונים (קנבס · SVG בלובי · SVG כאן) ולכן אי אפשר
 * לשתף קוד ציור. מה שכן משותף:
 *
 *   · הפרופורציות — אותן קואורדינטות בדיוק, במערכת של 64×64.
 *   · הפלטה — `lib/pressPalette.ts`.
 *   · ערכת הקבוצה — `data/teamColors.ts`, אותו מקור כמו החולצה
 *     בגיליון הבחירה ובכרטיס.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ למה דמות ולא סמל מועדון
 * ═══════════════════════════════════════════════════════════════
 *
 * הסמל אומר "איזו קבוצה". הדמות אומרת "**שחקן** מהקבוצה הזו" —
 * וזה ההבדל בין רשימת לוגואים לבין הרכב שעומד על הדשא.
 *
 * הבריף ביקש "שחקן בגרפיקה של שנות ה-90 עם מדים מתחלפים לפי
 * צבעי הקבוצה", וזה בדיוק מה שקורה כאן: אותה דמות, והחולצה
 * מקבלת את `primary`/`secondary`/`pattern` של המועדון.
 *
 * ★ הסמל לא נעלם — הוא ירד לתג קטן על החולצה, ראו `SquadPicker`.
 */
import { teamColor, GK_KIT, type TeamColor } from '../data/teamColors.ts';
import { PRESS } from '../lib/pressPalette.ts';
import type { Position } from '../lib/scoring/types.ts';

export interface FootballerProps {
  teamId?: string;
  position?: Position;
  /** מספר חולצה בעיגול. `null` = בלי עיגול. */
  shirt?: number | null;
  /** קפטן — סרט אדום על הזרוע והעיגול באדום. */
  captain?: boolean;
  /** סגן — עיגול כחול. */
  vice?: boolean;
  /** משבצת ריקה — מתאר מקווקו בלבד. */
  ghost?: boolean;
  className?: string;
}

/*
 * קואורדינטות הדמות, זהות לקנבס של הכרטיס (שם הן סביב 0,0).
 *
 * ★ ה-viewBox ריבועי (64×64) ולא 64×70, וזה לא פרט טכני:
 *   גובה הכרטיס על המגרש נגזר מגובה הדמות, וכל יחידה כאן
 *   מכריחה את כל המגרש להתכווץ. ראו `CARD_ASPECT`.
 */
const CX = 30;
const CY = 39;

export function Footballer({
  teamId, position, shirt = null, captain = false, vice = false,
  ghost = false, className = '',
}: FootballerProps) {
  const kit: TeamColor = ghost
    ? GHOST_KIT
    : position === 'GK'
      ? GK_KIT
      : teamColor(teamId ?? '');

  return (
    <svg viewBox="0 0 64 64" className={`w-full ${className}`} aria-hidden="true">
      <g
        transform={`translate(${CX},${CY})`}
        stroke={ghost ? 'rgba(18,16,14,.45)' : PRESS.ink}
        strokeWidth={ghost ? 1.6 : 1.9}
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray={ghost ? '3 3' : undefined}
      >
        {/* רגליים */}
        <g fill={ghost ? 'none' : SKIN}>
          <rect x="-6.6" y="6" width="5.6" height="15" rx="2" />
          <rect x="1" y="6" width="5.6" height="15" rx="2" />
        </g>
        {/* נעליים */}
        {!ghost && (
          <path d="M-9.5 21 h8 v3.4 h-8 z M1 21 h8 v3.4 h-8 z"
                fill={PRESS.ink} stroke="none" />
        )}
        {/* מכנסיים */}
        <rect x="-8" y="-2.5" width="16" height="9" rx="2"
              fill={ghost ? 'none' : PRESS.ink} />
        {/* זרועות */}
        <g fill={ghost ? 'none' : SKIN}>
          <rect x="-13.6" y="-14" width="4.8" height="12.5" rx="2" />
          <rect x="8.8" y="-14" width="4.8" height="12.5" rx="2" />
        </g>

        {/* ---- החולצה ---- */}
        <Shirt kit={kit} ghost={ghost} />

        {/* ★ סרט הקפטן — על הזרוע, כמו במגרש. תג מרחף מעל הראש
            התנגש בשורה שמעל ונראה כמו מדבקה על הציור. */}
        {captain && !ghost && (
          <rect x="-14.1" y="-11.8" width="5.4" height="4.2" rx="1.2"
                fill={PRESS.red} strokeWidth="1.2" />
        )}

        {/* ראש */}
        <circle cx="0" cy="-21" r="5.6" fill={ghost ? 'none' : SKIN} />
        {!ghost && (
          <path d="M-5.6 -22.2 a5.6 5.6 0 0 1 11.2 0 z" fill={HAIR} stroke="none" />
        )}
      </g>

      {/* ★ עיגול המספר — אותה צורה בדיוק כמו בכרטיס השיתוף:
          צהוב להרכב, אדום לקפטן, כחול לסגן, וקו מתאר שחור. */}
      {shirt !== null && !ghost && (
        <g>
          <circle
            cx="51" cy="12" r="9.5"
            fill={captain ? PRESS.red : vice ? TEKHELET : PRESS.mark}
            stroke={PRESS.ink} strokeWidth="2"
          />
          <text
            x="51" y="16" textAnchor="middle"
            fontSize="11" fontWeight="900" direction="ltr"
            fill={captain || vice ? '#fff' : PRESS.ink}
            style={{ fontFamily: 'Anton, Heebo, sans-serif' }}
          >
            {shirt}
          </text>
        </g>
      )}
    </svg>
  );
}

/**
 * החולצה — הפרט היחיד שמשתנה בין קבוצה לקבוצה.
 *
 * ★ ארבע התבניות מגיעות מ-`data/teamColors.ts`, אותו מקור שממנו
 *   מציירת גם החולצה בגיליון הבחירה. תבנית חדשה שם מופיעה כאן
 *   בלי לגעת בקובץ הזה.
 */
function Shirt({ kit, ghost }: { kit: TeamColor; ghost: boolean }) {
  const body = 'M-9.5 -16 h19 l1.6 13 h-22.2 z';
  const clipId = `sh-${kit.primary.slice(1)}-${kit.pattern}`;

  if (ghost) return <path d={body} fill="none" />;

  return (
    <>
      <defs>
        <clipPath id={clipId}><path d={body} /></clipPath>
      </defs>
      <path d={body} fill={kit.primary} />

      {kit.pattern === 'stripes' && (
        <g clipPath={`url(#${clipId})`} stroke="none" fill={kit.secondary}>
          <rect x="-10" y="-17" width="3" height="15" />
          <rect x="-4" y="-17" width="3" height="15" />
          <rect x="2" y="-17" width="3" height="15" />
          <rect x="8" y="-17" width="3" height="15" />
        </g>
      )}

      {kit.pattern === 'sash' && (
        <g clipPath={`url(#${clipId})`}>
          <path d="M-12 -17 L12 -1" stroke={kit.secondary} strokeWidth="5" fill="none" />
        </g>
      )}

      {/* מתאר מחדש אחרי המילוי — אחרת הפסים מכסים את הקו */}
      <path d={body} fill="none" />

      {kit.pattern === 'sleeves' && (
        <g fill={kit.secondary}>
          <rect x="-13.6" y="-14" width="4.8" height="7.4" rx="2" />
          <rect x="8.8" y="-14" width="4.8" height="7.4" rx="2" />
        </g>
      )}

      {/* צווארון */}
      <path d="M-3.6 -16 L0 -13 L3.6 -16"
            fill="none" stroke={kit.trim} strokeWidth="1.6" />
    </>
  );
}

const SKIN = '#D9A06B';
const HAIR = '#2B211A';
const TEKHELET = '#2F6FA8';

/** ערכה למשבצת ריקה. לא מצוירת בפועל — רק מספקת טיפוס. */
const GHOST_KIT: TeamColor = {
  primary: 'none', secondary: 'none', trim: 'none', pattern: 'plain', ink: '#000',
};
