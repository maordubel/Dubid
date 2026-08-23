/**
 * components/Jersey.tsx — חולצת משחק גנרית, בהשראת מסכי הפנטזי
 * שסופקו (Pizza Hut Fantasy / FPL) — לא שכפול של ערכה אמיתית של אף
 * מועדון. הצבע נגזר מ-`teamColors.ts`, השוער מקבל פלטה נפרדת
 * (כמו בכל משחק פנטזי אמיתי — חולצת שוער תמיד שונה מהחולצה הרגילה).
 */
import { teamColor } from '../data/teamColors.ts';
import type { Position } from '../lib/scoring/types.ts';

const GK_COLOR = { primary: '#2B2F38', trim: '#E8B23B' };

/** מונוגרמה קריאה לחזה החולצה: שתי האותיות הראשונות, בלי גרשיים/גרש. */
export function jerseyMonogram(short: string | undefined): string {
  if (!short) return '';
  return short.replace(/[״׳"']/g, '').slice(0, 2);
}

export function Jersey({
  teamId, position, monogram, ghost = false, size = 56,
}: {
  teamId?: string;
  position?: Position;
  monogram?: string;
  /** true = משבצת ריקה, מתאר עדין בלי מילוי */
  ghost?: boolean;
  size?: number;
}) {
  const { primary, trim } = position === 'GK' ? GK_COLOR : teamColor(teamId ?? '');

  if (ghost) {
    return (
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
        <path
          d="M40,10 L20,8 L2,26 L14,42 L24,30 L24,92 L76,92 L76,30 L86,42 L98,26 L80,8 L60,10 L50,22 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeDasharray="5 5"
          opacity="0.35"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <path
        d="M40,10 L20,8 L2,26 L14,42 L24,30 L24,92 L76,92 L76,30 L86,42 L98,26 L80,8 L60,10 L50,22 Z"
        fill={primary}
        stroke="rgba(0,0,0,0.25)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* מסגרת צווארון V */}
      <path d="M40,10 L50,20 L60,10" fill="none" stroke={trim} strokeWidth="3" strokeLinecap="round" />
      {/* מחשופי שרוול */}
      <path d="M5,25 L15,34" stroke={trim} strokeWidth="3" strokeLinecap="round" />
      <path d="M95,25 L85,34" stroke={trim} strokeWidth="3" strokeLinecap="round" />
      {monogram && (
        <text
          x="50" y="66" textAnchor="middle"
          fontSize="22" fontWeight="900" fill={trim} opacity="0.92"
          style={{ fontFamily: 'inherit' }}
        >
          {monogram}
        </text>
      )}
    </svg>
  );
}
