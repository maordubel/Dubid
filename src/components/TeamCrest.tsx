/**
 * components/TeamCrest.tsx — סמל קבוצה, עם נפילה חיננית לחולצה.
 *
 * קומפוננט אחד לכל מקום שבו מוצגת קבוצה: בחירת שחקן, בורר קבוצות,
 * מגרש, לוח משחקים, כרטיסים, דירוג. כך אין שני מקומות שמחליטים
 * מה קורה כשסמל חסר.
 */
import { useState } from 'react';
import { teamLogo } from '../data/teamLogos.ts';
import { teamColor } from '../data/teamColors.ts';
import { Jersey } from './Jersey.tsx';

/**
 * שני תווים לריבוע הזעיר.
 *
 * ★ למה זה לא `slice(0, 2)`
 *
 * הקיצורים בפורמט `<מועדון>.<עיר>` — `ה.תא`, `מ.נתניה`. חיתוך
 * נאיבי של שני תווים מחזיר `ה.` ו-`מ.` — כלומר **כל הקבוצות של
 * הפועל נראות זהות**, וכך גם כל אלה של מכבי. זה בדיוק ההפך
 * ממה שסמל אמור לעשות.
 *
 * הנכון: אות המועדון + האות הראשונה של העיר. `ה.תא` → `הת`,
 * `מ.נתניה` → `מנ`.
 */
function microShort(short?: string): string {
  const clean = (short ?? '').replace(/[״׳"']/g, '');
  const dot = clean.indexOf('.');
  if (dot > 0 && dot + 1 < clean.length) return clean[0] + clean[dot + 1];
  return clean.slice(0, 2);
}

export function TeamCrest({
  teamId, short, size = 32, className = '',
}: {
  teamId: string;
  /** קיצור לתצוגה כשאין סמל וגם החולצה קטנה מדי. */
  short?: string;
  /** פיקסלים, או `'fluid'` כדי למלא את רוחב ההורה. */
  size?: number | 'fluid';
  className?: string;
}) {
  const src = teamLogo(teamId);
  const fluid = size === 'fluid';
  const px = fluid ? 40 : (size as number);
  // ★ גם כשיש סמל הוא יכול להיכשל בטעינה (רשת, קובץ חסר).
  //   הדגל הזה הופך את הכישלון לנפילה מסודרת ולא לריבוע שבור.
  const [failed, setFailed] = useState(false);

  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={`object-contain ${fluid ? 'aspect-square w-full' : ''} ${className}`}
        style={fluid ? undefined : { width: px, height: px }}
      />
    );
  }

  // אין סמל — חולצה בצבעי המועדון. זהות תקינה, ובטוחה משפטית.
  if (fluid || px >= 26) {
    return (
      <span
        className={`inline-grid place-items-center ${fluid ? 'w-full' : ''} ${className}`}
        style={fluid ? undefined : { width: px, height: px }}
      >
        <Jersey teamId={teamId} size={fluid ? 'fluid' : px} />
      </span>
    );
  }

  // קטן מדי גם לחולצה — ריבוע בצבע המועדון עם הקיצור.
  const kit = teamColor(teamId);
  return (
    <span
      className={`inline-grid place-items-center rounded font-black ${className}`}
      style={{
        width: px, height: px,
        background: kit.primary, color: kit.ink,
        fontSize: Math.max(8, px * 0.38),
      }}
    >
      {microShort(short)}
    </span>
  );
}
