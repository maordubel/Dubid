/**
 * components/TeamTag.tsx — תג הקבוצה, בצבעי המועדון.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ הבעיה שהוא פותר
 * ═══════════════════════════════════════════════════════════════
 *
 * בבחירת שחקן, הקבוצה הוצגה בריבוע **אפור** של 32 פיקסלים עם
 * הקיצור בגודל 10px. שתי תקלות באותו אלמנט:
 *
 *  1. **אפור.** במשחק פנטזי המשתמש לא קורא — הוא **סורק צבעים**.
 *     צהוב־שחור זה בית״ר לפני שהעין הגיעה לטקסט. ריבוע אפור
 *     מכריח קריאה, וקריאה איטית פי כמה מזיהוי.
 *
 *  2. **צר מדי.** הקיצורים החדשים (`מ.נתניה`, `ב.סכנין`) הם
 *     שבעה תווים. בריבוע של 32px הם נחתכים ל-`מ.נת…` — כלומר
 *     בדיוק החזרה לבעיה שהפורמט החדש בא לפתור.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ מה התג עושה
 * ═══════════════════════════════════════════════════════════════
 *
 * גלולה ברוחב תוכן, בצבע החולצה של המועדון, עם דיו שמחושב
 * לניגודיות (`inkOn` ב-`data/teamColors.ts`) — כך אי אפשר לקבל
 * לבן על צהוב בטעות.
 *
 * ★ רמז התבנית
 *
 * מועדון בפסים או עם שרוולים מקבל **פס דק בקצה** בצבע המשני.
 * זה מה שמבדיל בין הפועל ירושלים (לבן־שחור פסים) לבין בני סכנין
 * (לבן) — שתי חולצות שבצבע גוף בלבד נראות זהות.
 *
 * ★ מה זה **לא**: זה לא סמל המועדון. הסמל הוא `TeamCrest`, והוא
 *   עדיין הדבר הראשון שהעין תופסת. התג הוא השם, קריא, בצבע.
 */
import { teamColor } from '../data/teamColors.ts';

export type TeamTagSize = 'xs' | 'sm' | 'md';

const SIZE: Record<TeamTagSize, { text: string; pad: string; h: string }> = {
  xs: { text: 'text-[9.5px]',  pad: 'px-1.5', h: 'leading-[16px]' },
  sm: { text: 'text-[11px]',   pad: 'px-2',   h: 'leading-[20px]' },
  md: { text: 'text-[12.5px]', pad: 'px-2.5', h: 'leading-[24px]' },
};

export interface TeamTagProps {
  teamId: string;
  /** הקיצור להצגה — `ה.תא`. אם חסר, מוצג המזהה. */
  short?: string;
  size?: TeamTagSize;
  /** שם מלא, ל-`title` ולקוראי מסך. */
  name?: string;
  /** מעומעם — לשחקן חסום. שומר על הצבע, מוריד נוכחות. */
  muted?: boolean;
  className?: string;
}

export function TeamTag({
  teamId, short, size = 'sm', name, muted = false, className = '',
}: TeamTagProps) {
  const kit = teamColor(teamId);
  const s = SIZE[size];

  /* ★ פס הרמז מופיע רק כשיש מה לרמוז.
     בחולצה אחידה `secondary === primary`, ופס בצבע זהה הוא
     פיקסלים שלא אומרים כלום. */
  const hint = kit.pattern !== 'plain' && kit.secondary !== kit.primary;

  return (
    <span
      title={name}
      dir="rtl"
      className={`relative inline-flex shrink-0 items-center overflow-hidden rounded-md
                  font-black tabular-nums ${s.text} ${s.pad} ${s.h} ${className}`}
      style={{
        background: kit.primary,
        color: kit.ink,
        opacity: muted ? 0.5 : 1,
        /* קו מתאר דק — חולצה לבנה על רקע בהיר צריכה גבול, וחולצה
           כהה על רקע כהה צריכה הפרדה. אותו קו עושה את שניהם. */
        boxShadow: `inset 0 0 0 1px ${kit.ink}22`,
      }}
    >
      {hint && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 start-0 w-[3px]"
          style={{ background: kit.secondary }}
        />
      )}
      <span className={hint ? 'ps-1' : undefined}>{short ?? teamId}</span>
    </span>
  );
}

/**
 * ★ גרסת "רק צבע" — נקודה בצבע החולצה, בלי טקסט.
 *
 * למקומות שבהם אין רוחב לשם אבל כן צריך זיהוי: שורות טבלה צפופות,
 * ורשימות ארוכות שבהן השם כבר מופיע ליד.
 */
export function TeamDot({
  teamId, size = 8, className = '',
}: { teamId: string; size?: number; className?: string }) {
  const kit = teamColor(teamId);
  const hint = kit.pattern !== 'plain' && kit.secondary !== kit.primary;
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 rounded-full ${className}`}
      style={{
        width: size,
        height: size,
        background: hint
          ? `linear-gradient(90deg, ${kit.primary} 50%, ${kit.secondary} 50%)`
          : kit.primary,
        boxShadow: `inset 0 0 0 1px ${kit.ink}33`,
      }}
    />
  );
}
