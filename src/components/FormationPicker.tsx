/**
 * components/FormationPicker.tsx — בחירת מערך טקטי.
 *
 * ★ הברִיף: "המשתמש צריך לראות תצוגה מקדימה של מגרש מוקטן לפני
 *   שהוא בוחר."
 *
 * מחרוזת "4-2-3-1" היא לא מידע — היא קוד. נקודות על מגרש הן
 * מידע. התצוגה כאן נבנית מאותה `layoutFormation` שמציירת את
 * המגרש האמיתי, ולכן מה שרואים בבורר הוא **בדיוק** מה שיתקבל.
 * לו הייתה כאן פריסה משלה, יום אחד הן היו נפרדות.
 */
import { layoutFormation, type FormationOption } from '../lib/formation.ts';
import { PRESS } from '../lib/pressPalette.ts';

export function FormationPicker({
  options, value, onChange, disabled = false,
}: {
  options: readonly FormationOption[];
  value: string;
  onChange: (formation: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="px-3 pt-3">
      <div className="mx-auto max-w-3xl">
        {/* ★ משפט אחד שמסביר מה קורה כשמחליפים.
            בלעדיו, החלפת מערך שמפילה שחקנים נראית כמו באג. */}
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="text-[11px] font-black tracking-widest text-chalk-dim">
            בחר מערך — הבחירות נשמרות במידת האפשר
          </h2>
          <span className="num text-xs font-black text-gold" dir="ltr">{value}</span>
        </div>

        {/* גלילה אופקית רק כאן, ורק כשצריך. שאר המסך לא זז. */}
        <ul
          role="radiogroup"
          aria-label="בחירת מערך"
          className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]
                     [&::-webkit-scrollbar]:hidden"
        >
          {options.map((o) => (
            <li key={o.id} className="shrink-0">
              <button
                type="button"
                role="radio"
                aria-checked={o.id === value}
                disabled={disabled}
                onClick={() => onChange(o.id)}
                className={[
                  'tap flex w-[86px] flex-col items-center gap-1 rounded-xl border p-1.5',
                  'transition-colors duration-200 ease-brand disabled:opacity-40',
                  o.id === value
                    ? 'border-gold bg-gold/10'
                    : 'border-gold/15 bg-night-2 hover:border-chalk/25',
                ].join(' ')}
              >
                <MiniPitch formation={o.id} active={o.id === value} />
                <span
                  dir="ltr"
                  className={`num text-[11px] font-black ${
                    o.id === value ? 'text-gold' : 'text-chalk'
                  }`}
                >
                  {o.id}
                </span>
                <span className="text-[9px] leading-tight text-chalk-dim">{o.hintHe}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * מגרש מוקטן. אותה פריסה כמו המגרש הגדול, רק בלי כרטיסים —
 * נקודה לכל שחקן. בגודל הזה נקודה קריאה יותר מכל דבר אחר.
 */
function MiniPitch({ formation, active }: { formation: string; active: boolean }) {
  const layout = layoutFormation(formation);
  if (!layout) return null;

  return (
    <svg
      viewBox="0 0 100 138"
      className="h-[58px] w-auto rounded-md"
      aria-hidden="true"
    >
      {/* ★ אותו דשא מודפס כמו המגרש הגדול ובכרטיס.
          תצוגה מקדימה בצבע אחר היא תצוגה מקדימה של משהו אחר. */}
      <rect width="100" height="138" rx="2"
            fill={active ? PRESS.grass : PRESS.grassDark} />
      <g stroke={PRESS.line} strokeWidth="1" fill="none">
        <rect x="4" y="4" width="92" height="130" />
        <line x1="4" y1="69" x2="96" y2="69" />
        <circle cx="50" cy="69" r="14" />
      </g>
      <rect x="0.9" y="0.9" width="98.2" height="136.2" rx="2"
            fill="none" stroke={PRESS.ink} strokeWidth="1.8" />
      {layout.slots.map((s, i) => (
        <circle
          key={i}
          cx={s.x}
          // גובה 138 מול 100 באחוזים — ממירים ליחידות ה-viewBox
          cy={(s.y / 100) * 138}
          r={s.position === 'GK' ? 4.6 : 5.2}
          fill={active ? PRESS.mark : PRESS.paper}
          stroke={PRESS.ink}
          strokeWidth="1.4"
          opacity={s.position === 'GK' ? 0.85 : 1}
        />
      ))}
    </svg>
  );
}
