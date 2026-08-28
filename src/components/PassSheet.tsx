/**
 * components/PassSheet.tsx — "כרטיס המנוי". המסך שנותן לאורח מפתח.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★★★ הרגע — וזו כל התכונה ★★★
 * ═══════════════════════════════════════════════════════════════
 *
 * המסך הזה מופיע **מיד אחרי ההגשה הראשונה**, ולא לפניה.
 *
 * זו לא החלטה על סדר מסכים אלא על מה שהמשתמש מרגיש. אורח שנכנס
 * לפני שנייה לא בנה כלום; "שמור את החשבון שלך" באותו רגע הוא
 * מס כניסה על משהו שאין לו. אותו מסך בדיוק, אחרי שהוא בחר
 * אחד־עשר שחקנים ונעל אותם, מדבר על **מה שהוא בנה** — והוא
 * מרגיש את זה כשלו (אפקט הבעלות, ואפקט IKEA: מה שהשקעת בו
 * שווה לך יותר).
 *
 * ═══════════════════════════════════════════════════════════════
 * ★★ למה זה לא מרגיש כמו חכה ★★
 * ═══════════════════════════════════════════════════════════════
 *
 * כי בשלב הזה **אנחנו לא מבקשים כלום.**
 *
 * המסך הוא מתנה שלמה בפני עצמה: הנה מפתח, הנה תמונה, שמור
 * אותה, סגור. אין שדה חובה, אין "המשך", אין × שמסתיר משהו.
 * משתמש שיסגור עכשיו יצא עם בדיוק מה שהובטח לו.
 *
 * ורק מתחת לזה, אחרי שהערך כבר נמסר, יושבת שורה אחת שקטה:
 * "שנשלח לך גם למייל?". זה כל המנגנון. הוא עובד בדיוק בגלל
 * שהוא בא **אחרי** הנתינה ולא במקומה — הדדיות, ולא מלכודת.
 *
 * ★ ארבעה דברים שאין כאן, כל אחד במכוון:
 *   · אין חסימה. אפשר לסגור בכל רגע, וזה מסתיים.
 *   · אין ספירה לאחור ואין "ההצעה תיעלם".
 *   · אין מספרים מומצאים ("12,000 שמרו היום").
 *   · אין שדה חובה. אף פעם.
 */
import { useEffect, useRef, useState } from 'react';
import { CARD_W, CARD_H } from '../lib/shareCard.ts';
import {
  renderPassCard, buildPassMessage, passFileName, type PassCardData,
} from '../lib/passCard.ts';
import {
  canvasToBlob, shareCardImage, shareToWhatsApp, downloadBlob, copyToClipboard,
} from '../lib/share.ts';
import { captureLead } from '../lib/leads.ts';

export interface PassSheetProps {
  data: PassCardData;
  /** מאיפה נפתח — לשיוך הליד. */
  source: 'submit' | 'account' | 'nudge';
  gameweekCode?: string;
  onClose: () => void;
}

export function PassSheet({ data, source, gameweekCode, onClose }: PassSheetProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [failed, setFailed] = useState(false);
  const [kept, setKept] = useState(false);
  const [copied, setCopied] = useState(false);

  /*
   * ★ ה-Blob מוכן **לפני** הלחיצה, ולא בתוכה.
   *
   * iOS חוסם `navigator.share` שנקרא אחרי `await` ארוך — הוא
   * מאבד את "מחוות המשתמש". רינדור מראש הופך את הלחיצה
   * לסינכרונית, וזה ההבדל בין שיתוף שעובד לבין כלום.
   */
  useEffect(() => {
    let alive = true;
    void renderPassCard(data, { canvas: canvasRef.current ?? undefined })
      .then((c) => canvasToBlob(c))
      .then((b) => { if (alive) setBlob(b); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [data]);

  const text = buildPassMessage(data);
  const fileName = passFileName();

  return (
    <div
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label="כרטיס המנוי שלך"
      className="fixed inset-0 z-[70] flex flex-col bg-night/94 backdrop-blur-sm"
    >
      <header className="flex items-center gap-2.5 px-5 pt-[calc(1rem+env(safe-area-inset-top))]">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gold/12 text-gold">
          <TicketIcon />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-press text-[18px] font-black leading-none text-chalk">
            הכרטיס שלך מוכן
          </h2>
          {/*
            ★ הניסוח הזה נבחר בקפידה.
            "גיבוי" ו"שחזור" הן מילים של תקלה. "כרטיס" היא מילה
            של בעלות — ואנשים לא מאבדים כרטיסים, הם שומרים אותם.
          */}
          <p className="mt-1 truncate text-[11.5px] text-chalk-dim">
            שמרו אותו — הוא הכניסה שלכם מכל מכשיר
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="tap shrink-0 rounded-full px-3 py-1.5 text-[12px] font-bold text-chalk-dim
                     transition-colors active:text-chalk"
        >
          {kept ? 'סיימתי' : 'אחר כך'}
        </button>
      </header>

      {/* ---- הכרטיס ---- */}
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-3">
        <div className="relative overflow-hidden rounded-2xl shadow-[0_30px_70px_-30px_#000]">
          <canvas
            ref={canvasRef}
            width={CARD_W}
            height={CARD_H}
            aria-label="תצוגה מקדימה של כרטיס המנוי"
            className="block h-auto max-h-[46vh] w-auto max-w-full"
          />
        </div>
      </div>

      {/* ---- הפעולות ---- */}
      <div className="shrink-0 px-5 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {/*
          ★★ סדר הכפתורים הוא סדר ההסתברות ★★

          "שמירה לגלריה" ראשונה כי היא הפעולה שהכי הרבה אנשים
          יעשו והכי מעטים יתחרטו עליה. וואטסאפ שנייה כי היא
          הדרך שבה אנשים באמת שולחים לעצמם. גיליון השיתוף
          (אינסטגרם, טלגרם, אימייל, כל השאר) שלישי — הוא הכי
          גמיש והכי פחות מובן מאליו.
        */}
        <button
          type="button"
          disabled={!blob}
          onClick={() => {
            if (!blob) return;
            downloadBlob(blob, fileName);
            setKept(true);
          }}
          className="tap h-14 w-full rounded-full bg-gradient-to-b from-gold-light to-gold
                     font-poster text-xl text-gold-ink transition-transform duration-200
                     ease-brand active:scale-[.98] disabled:opacity-40"
        >
          {blob ? 'שמירת הכרטיס לגלריה' : 'מכין את הכרטיס…'}
        </button>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={!blob}
            onClick={() => {
              if (!blob) return;
              /* ★ "לעצמי" ולא "לחבר". `wa.me` בלי מספר פותח את
                 בורר אנשי הקשר, ושם המשתמש בוחר את עצמו — זו
                 הדרך היחידה שעובדת בלי לבקש ממנו מספר טלפון. */
              shareToWhatsApp(text, data.link, blob);
              setKept(true);
            }}
            className="tap h-12 rounded-full border border-gold/35 text-[13px] font-bold
                       text-gold-light disabled:opacity-40"
          >
            וואטסאפ לעצמי
          </button>
          <button
            type="button"
            disabled={!blob}
            onClick={() => {
              if (!blob) return;
              void shareCardImage({
                blob, fileName, title: 'כרטיס המנוי שלי בדוביד', text, url: data.link,
              }).then((r) => {
                if (r.method !== 'cancelled' && r.method !== 'failed') setKept(true);
              });
            }}
            className="tap h-12 rounded-full border border-gold/35 text-[13px] font-bold
                       text-gold-light disabled:opacity-40"
          >
            שיתוף · אינסטגרם
          </button>
        </div>

        {/* ★ העתקת המפתח לא תלויה ב-blob: היא זמינה מיד, ועובדת
            גם כשיצירת התמונה נכשלה. */}
        <button
          type="button"
          onClick={() => {
            void copyToClipboard(`${data.pretty}\n${data.link}`).then((ok) => {
              if (ok) {
                setCopied(true);
                setKept(true);
                window.setTimeout(() => setCopied(false), 2200);
              }
            });
          }}
          className="tap mt-1.5 h-11 w-full text-[12.5px] font-bold text-chalk-dim
                     transition-colors active:text-chalk"
        >
          {copied ? 'הועתק ✓' : `העתקת המפתח · ${data.pretty}`}
        </button>

        {failed && (
          <p role="alert" className="mt-1 text-center text-[11.5px] text-flare">
            לא הצלחנו להכין את התמונה. המפתח למעלה עובד — אפשר להעתיק אותו.
          </p>
        )}

        <MailBackup source={source} gameweekCode={gameweekCode} />
      </div>
    </div>
  );
}

/* ================================================================== */
/* השורה השקטה                                                        */
/* ================================================================== */

/**
 * ═══════════════════════════════════════════════════════════════
 * ★★★ לכידת הליד — ולמה היא נראית ככה ★★★
 * ═══════════════════════════════════════════════════════════════
 *
 * זו הנקודה שבה המוצר מבקש משהו, ויש בה בדיוק שלוש החלטות:
 *
 * **1. היא מגיעה אחרונה, אחרי שהערך כבר נמסר.**
 *    המשתמש כבר קיבל את הכרטיס, כבר שמר אותו, ולא חייב כלום.
 *    בקשה שבאה אחרי נתינה נקראת כהמשך; אותה בקשה לפני הנתינה
 *    נקראת כמחיר.
 *
 * **2. היא מנוסחת כשירות, כי היא באמת שירות.**
 *    "שנשלח לך עותק?" — זה מה שהיא עושה. לא "הצטרפו לרשימת
 *    התפוצה", לא "קבלו עדכונים". אם היינו צריכים לנסח את זה
 *    יפה כדי שיסכימו, זה סימן שזה לא מה שזה.
 *
 * **3. הסכמה לתזכורות היא תיבה נפרדת, כבויה.**
 *    זה המקום היחיד שבו קל מאוד לרמות: תיבה מסומנת מראש הייתה
 *    מכפילה את שיעור ההסכמה. היא גם הייתה הופכת את המשפט
 *    "אנחנו לא על החכה שלך" לשקר — והמשתמש מגלה את זה בדיוק
 *    כשהוא מקבל את המייל הראשון שלא ביקש.
 *
 * ★ ומה שסוגר את הלולאה: "להסיר אותי" מופיע מיד אחרי השמירה,
 *   באותו מקום. החלטה הפיכה מתקבלת בקלות — וזו הסיבה
 *   האמיתית שאנשים ישאירו כאן מייל.
 */
function MailBackup({
  source, gameweekCode,
}: { source: string; gameweekCode?: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <p className="mt-2.5 text-center text-[11.5px] leading-snug text-chalk-dim">
        נשמר. נשלח לך את הכרטיס למייל.{' '}
        <button
          type="button"
          onClick={() => { void import('../lib/leads.ts').then((m) => m.forgetMe()); setDone(false); setEmail(''); }}
          className="underline underline-offset-2"
        >
          להסיר אותי
        </button>
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2.5 w-full text-center text-[11.5px] text-chalk-dim
                   underline underline-offset-2 transition-colors active:text-chalk"
      >
        רוצים שנשלח לכם עותק גם למייל?
      </button>
    );
  }

  return (
    <div className="mt-2.5 rounded-xl border border-gold/20 bg-night-2 p-3">
      <label className="block">
        <span className="text-[11px] text-chalk-dim">המייל שלך</span>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          dir="ltr"
          value={email}
          disabled={busy}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="mt-1 w-full rounded-lg border border-gold/25 bg-night px-3 py-2
                     text-[13px] text-chalk outline-none focus:border-gold disabled:opacity-50"
        />
      </label>

      <label className="mt-2 flex items-start gap-2 text-[11px] leading-snug text-chalk-dim">
        <input
          type="checkbox"
          checked={consent}
          disabled={busy}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[#D8B25C]"
        />
        <span>
          אפשר לשלוח לי גם תזכורת לפני נעילת המחזור.
          <span className="block text-chalk-dim/70">לא חובה. אפשר להסיר בכל רגע.</span>
        </span>
      </label>

      {error && (
        <p role="alert" className="mt-2 text-[11.5px] font-bold text-flare">{error}</p>
      )}

      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          disabled={busy || email.trim().length < 5}
          onClick={() => {
            setBusy(true); setError(null);
            void captureLead({ email, consent, source, gameweekCode })
              .then(() => setDone(true))
              .catch((e: unknown) => setError(
                e instanceof Error && e.message === 'EMAIL_INVALID'
                  ? 'הכתובת לא נראית תקינה'
                  : 'לא הצלחנו לשמור. אפשר לנסות שוב.'))
              .finally(() => setBusy(false));
          }}
          className="tap flex-1 rounded-lg bg-gold px-4 py-2 text-[12.5px] font-black
                     text-gold-ink disabled:opacity-40"
        >
          {busy ? 'שומר…' : 'שליחה'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setOpen(false)}
          className="tap rounded-lg border border-gold/25 px-3 py-2 text-[12px] text-chalk-dim"
        >
          לא צריך
        </button>
      </div>
    </div>
  );
}

function TicketIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true">
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h11A1.5 1.5 0 0 1 17 6.5V8a2 2 0 0 0 0 4v1.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 13.5V12a2 2 0 0 0 0-4V6.5Z"
            stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M11.5 5v10" stroke="currentColor" strokeWidth="1.5" strokeDasharray="1.6 1.8" />
    </svg>
  );
}
