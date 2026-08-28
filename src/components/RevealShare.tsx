/**
 * components/RevealShare.tsx — הרגע שאחרי "הגש".
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ למה המסך הזה קיים
 * ═══════════════════════════════════════════════════════════════
 *
 * עד עכשיו, הרגע שאחרי ההגשה היה: המודל נסגר, והמסך עבר לכרטיס.
 * זהו. הרגע החזק ביותר בשבוע של המוצר — שנייה אחרי שמישהו קיבל
 * אחת־עשרה החלטות שהוא מאמין בהן — הסתיים בלי שאף אחד ביקש ממנו
 * כלום.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ שלושה כללים שמכתיבים כל פרט כאן
 * ═══════════════════════════════════════════════════════════════
 *
 * **1. לבקש כשהאנרגיה גבוהה, לא כשנוח לנו.**
 * הבקשה מגיעה מיד אחרי מאמץ שהושלם. זה הרגע שבו אנשים הכי
 * נדיבים — ולכן זה הרגע היחיד שבו מותר לבקש.
 *
 * **2. בקשה אחת, ולא שלוש.**
 * "שתף · הזמן חברים · דרג אותנו" הופך רגע של גאווה לרשימת
 * מטלות. כאן: כפתור ראשי אחד. השאר קטנים ושקטים.
 *
 * **3. סירוב חייב להיות זול.**
 * "לא עכשיו" יושב בגובה העין ולא מוסתר. מסך שקשה לסגור נזכר
 * לרעה, והפעם הבאה שהוא יופיע — ייסגר מהר יותר.
 *
 * ★ ומה שלא נעשה: המסך הזה **לא** חוזר. הוא מופיע פעם אחת לכל
 *   הגשה, ואם נסגר — נגמר. באנר שרודף הורג את המוצר ולא את
 *   הבאנר.
 */
import { useEffect, useRef, useState } from 'react';

import { renderRevealCard, type RevealCardData } from '../lib/revealCard.ts';
import { CARD_W, CARD_H } from '../lib/shareCard.ts';
import { canvasToBlob, shareCardImage, shareToWhatsApp, downloadBlob } from '../lib/share.ts';
import { modeTheme, modeVars } from '../lib/modeTheme.ts';
import { ModeMark } from './ModeMark.tsx';
import { text as content } from '../lib/content.ts';

export interface RevealShareProps {
  data: RevealCardData;
  onClose: () => void;
}

/**
 * ★ הטקסט שנוסע עם התמונה.
 *
 * הוא לא מתאר את התמונה — הוא **שואל שאלה**. הודעה שמסתיימת
 * בשאלה מקבלת תשובה; הודעה שמסתיימת בהכרזה מקבלת לייק.
 */
export function buildRevealText(d: RevealCardData): string {
  const t = modeTheme(d.mode);
  const cap = d.lineup.find((p) => p.isCaptain);
  const capPart = cap ? ` הקפטן שלי: ${cap.name}.` : '';
  /* ★ ניתן לעקיפה מלוח הניהול — קמפיין הוא החלטה שיווקית,
     לא קוד. ריק = הטקסט האוטומטי, שכולל את שם הקפטן. */
  const custom = content('share.text').trim();
  if (custom) return custom;

  return `סגרתי הרכב ל${d.gameweekLabel} · ${t.name}.${capPart} ` +
         `אתם הייתם בוחרים אחרת? 👇`;
}

export function RevealShare({ data, onClose }: RevealShareProps) {
  const t = modeTheme(data.mode);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /* ★ ה-Blob מוכן **לפני** הלחיצה, ולא בתוכה.
     iOS חוסם `navigator.share` שנקרא אחרי `await` ארוך — הוא
     כבר לא נחשב "מתוך אינטראקציה". זו הסיבה היחידה שהכרטיס
     מצויר ברגע שהמסך נפתח ולא כשלוחצים. */
  const [blob, setBlob] = useState<Blob | null>(null);
  const [failed, setFailed] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const canvas = canvasRef.current;
        if (!canvas) return;
        await renderRevealCard(data, { canvas });
        const b = await canvasToBlob(canvas);
        if (alive) setBlob(b);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => { alive = false; };
  }, [data]);

  const fileName = `dubid-${data.mode}-${data.gameweekLabel.replace(/\s/g, '')}.png`;
  const text = buildRevealText(data);

  const share = () => {
    if (!blob) return;
    void shareCardImage({ blob, fileName, title: 'דוביד', text, url: data.url })
      .then((r) => { if (r.method !== 'cancelled' && r.method !== 'failed') setSent(true); });
  };

  return (
    <div
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label="שיתוף ההרכב"
      style={modeVars(data.mode)}
      className="fixed inset-0 z-[70] flex flex-col bg-night/92 backdrop-blur-sm"
    >
      {/* ---- כותרת ---- */}
      <header className="flex items-center gap-2.5 px-5 pt-[calc(1rem+env(safe-area-inset-top))]">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-xl"
          style={{ color: 'var(--mode-accent-light)', background: 'rgba(255,255,255,.06)' }}
        >
          <ModeMark mode={data.mode} size={22} weight={2.8} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-press text-[18px] font-black leading-none text-chalk">ההרכב נעול</h2>
          <p className="mt-1 truncate text-[11.5px] text-chalk-dim">
            {t.name} · {data.gameweekLabel}
            {data.deadlineLabel && ` · נעילה ${data.deadlineLabel}`}
          </p>
        </div>
        {/* ★ סגירה בגובה העין ובגודל מלא. ראו כלל 3. */}
        <button
          type="button"
          onClick={onClose}
          className="tap shrink-0 rounded-full px-3 py-1.5 text-[12px] font-bold text-chalk-dim
                     transition-colors active:text-chalk"
        >
          לא עכשיו
        </button>
      </header>

      {/* ---- הכרטיס ---- */}
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-4">
        <div
          className="relative overflow-hidden rounded-2xl"
          style={{ boxShadow: 'var(--mode-glow)' }}
        >
          <canvas
            ref={canvasRef}
            width={CARD_W}
            height={CARD_H}
            aria-label="תצוגה מקדימה של הכרטיס"
            className="block h-auto w-auto max-h-[min(58vh,520px)] max-w-full"
            style={{ aspectRatio: `${CARD_W} / ${CARD_H}` }}
          />
          {!blob && !failed && (
            <div className="absolute inset-0 grid place-items-center bg-night/60">
              <span className="text-[12px] text-chalk-dim">מכין את הכרטיס…</span>
            </div>
          )}
        </div>
      </div>

      {/* ---- פעולות ---- */}
      <div className="px-6 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        {/* ★ המשפט הזה הוא ההצדקה של הכפתור.
            בלעדיו "שתף" הוא בקשה; איתו הוא הזמנה לוויכוח שהמשתמש
            ממילא רוצה לנהל. */}
        <p className="mb-3 text-center text-[13px] leading-snug text-chalk-2">
          {sent
            ? 'נשלח. עכשיו נחכה ונראה מי צדק.'
            : content('submit.success')}
        </p>

        <button
          type="button"
          onClick={share}
          disabled={!blob}
          className="tap w-full rounded-full py-3 font-poster text-[16px] text-night
                     transition-opacity disabled:opacity-40"
          style={{
            background:
              'linear-gradient(180deg, var(--mode-accent-light), var(--mode-accent))',
          }}
        >
          שיתוף לסטורי
        </button>

        <div className="mt-2.5 flex items-center justify-center gap-2">
          <SmallAction
            label="וואטסאפ"
            disabled={!blob}
            onClick={() => { if (blob) { shareToWhatsApp(text, data.url, blob); setSent(true); } }}
          />
          <span aria-hidden="true" className="text-[10px] text-chalk-dim">·</span>
          <SmallAction
            label="שמירת תמונה"
            disabled={!blob}
            onClick={() => { if (blob) { downloadBlob(blob, fileName); setSent(true); } }}
          />
        </div>

        {failed && (
          <p role="alert" className="mt-3 text-center text-[11.5px] text-flare">
            לא הצלחנו להכין את הכרטיס. ההרכב נשמר — אפשר לשתף מאוחר יותר מהכרטיס.
          </p>
        )}
      </div>
    </div>
  );
}

function SmallAction({
  label, onClick, disabled,
}: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="tap rounded-full px-3 py-1.5 text-[12px] font-bold text-chalk-2
                 transition-colors active:text-chalk disabled:opacity-40"
    >
      {label}
    </button>
  );
}
