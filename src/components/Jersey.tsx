/**
 * components/Jersey.tsx — חולצת משחק.
 *
 * ★ למה חולצה ולא לוגו
 *
 * לוגו הוא רכוש של המועדון. חולצה היא שפה. במגרש, בטלוויזיה,
 * ובכל משחק פנטזי שאי פעם עבד — מזהים קבוצה לפי הצבע והתבנית.
 * הצורה כאן היא שלנו: כתפיים מרובעות, צווארון V, קו תפר יחיד.
 * מספיק ארכאית כדי להרגיש כמו אלבום מדבקות, מספיק נקייה כדי
 * להיקרא ב-28 פיקסלים במובייל.
 *
 * הצבעים והתבנית מגיעים מ-`teamColors.ts` ולא מוקלדים כאן.
 */
import { teamColor, GK_KIT, type KitPattern } from '../data/teamColors.ts';
import type { Position } from '../lib/scoring/types.ts';

/** מונוגרמה לחזה: שתי אותיות, בלי גרשיים. */
export function jerseyMonogram(short: string | undefined): string {
  if (!short) return '';
  return short.replace(/[״׳"']/g, '').slice(0, 2);
}

/** קו המתאר של החולצה. מוגדר פעם אחת — הצללית זהה בכל מצב. */
const SHIRT =
  'M40,10 L20,8 L2,26 L14,42 L24,30 L24,92 L76,92 L76,30 L86,42 L98,26 L80,8 L60,10 L50,22 Z';

/** גוף החולצה בלבד, בלי שרוולים — לחיתוך פסים ואלכסון. */
const BODY = 'M24,30 L24,92 L76,92 L76,30 L60,10 L50,22 L40,10 Z';

export function Jersey({
  teamId, position, monogram, ghost = false, size = 56, captain = false,
}: {
  teamId?: string;
  position?: Position;
  monogram?: string;
  /** משבצת ריקה — מתאר מקווקו בלבד. */
  ghost?: boolean;
  /**
   * גודל בפיקסלים. העבירו `'fluid'` כדי שהחולצה תמלא את הרוחב
   * של ההורה — כך המגרש קובע את הגודל ולא הקומפוננטה.
   */
  size?: number | 'fluid';
  /** סרט קפטן על השרוול. */
  captain?: boolean;
}) {
  const kit = position === 'GK' ? GK_KIT : teamColor(teamId ?? '');
  const fluid = size === 'fluid';
  const dims = fluid
    ? { width: '100%', height: 'auto' as const }
    : { width: size as number, height: size as number };
  // מזהה ייחודי ל-clipPath: שתי חולצות באותו מסך לא יגנבו זו לזו את החיתוך.
  const uid = `${teamId ?? 'x'}-${position ?? 'x'}`;

  if (ghost) {
    return (
      <svg viewBox="0 0 100 100" {...dims} aria-hidden="true" className={fluid ? 'w-full' : undefined}>
        <path d={SHIRT} fill="none" stroke="currentColor" strokeWidth="3"
              strokeDasharray="5 5" opacity="0.35" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 100 100" {...dims} aria-hidden="true" className={fluid ? 'w-full' : undefined}>
      <defs>
        <clipPath id={`body-${uid}`}><path d={BODY} /></clipPath>
      </defs>

      {/* גוף */}
      <path d={SHIRT} fill={kit.primary} stroke="rgba(0,0,0,.28)"
            strokeWidth="1.5" strokeLinejoin="round" />

      <Pattern pattern={kit.pattern} kit={kit} uid={uid} />

      {/* צווארון V ומחשופי שרוול — תמיד מעל התבנית */}
      <path d="M40,10 L50,20 L60,10" fill="none" stroke={kit.trim}
            strokeWidth="3" strokeLinecap="round" />
      <path d="M5,25 L15,34" stroke={kit.trim} strokeWidth="3" strokeLinecap="round" />
      <path d="M95,25 L85,34" stroke={kit.trim} strokeWidth="3" strokeLinecap="round" />

      {captain && (
        // סרט הקפטן יושב על השרוול, לא על החזה — שם הוא באמת נמצא.
        <rect x="26" y="36" width="16" height="7" rx="3"
              fill="#FFC93C" stroke="rgba(0,0,0,.3)" strokeWidth="1" />
      )}

      {monogram && (
        <text x="50" y="68" textAnchor="middle" fontSize="21" fontWeight="900"
              fill={kit.ink} opacity="0.9" style={{ fontFamily: 'inherit' }}>
          {monogram}
        </text>
      )}
    </svg>
  );
}

/** התבניות. כל אחת חתוכה לגוף החולצה כדי שלא תגלוש על השרוולים. */
function Pattern({
  pattern, kit, uid,
}: { pattern: KitPattern; kit: { secondary: string }; uid: string }) {
  if (pattern === 'plain') return null;
  const clip = `url(#body-${uid})`;

  if (pattern === 'stripes') {
    // ארבעה פסים ברוחב 9 — מספיק עבים כדי להיקרא בגודל קטן.
    return (
      <g clipPath={clip}>
        {[26, 44, 62].map((x) => (
          <rect key={x} x={x} y="8" width="9" height="86" fill={kit.secondary} />
        ))}
      </g>
    );
  }

  if (pattern === 'sleeves') {
    // השרוולים הם מה ש*מחוץ* לגוף — מציירים אותם מעל הצללית המלאה.
    return (
      <g>
        <path d="M40,10 L20,8 L2,26 L14,42 L24,30 L24,44 L24,30 Z"
              fill={kit.secondary} opacity="0.95" />
        <path d="M60,10 L80,8 L98,26 L86,42 L76,30 L76,44 L76,30 Z"
              fill={kit.secondary} opacity="0.95" />
      </g>
    );
  }

  // sash — אלכסון על החזה
  return (
    <g clipPath={clip}>
      <path d="M24,30 L52,10 L70,10 L24,52 Z" fill={kit.secondary} />
    </g>
  );
}
