/**
 * components/AuthPanel.tsx — התחברות.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★★★ מסך אחד, ולא שניים ★★★
 * ═══════════════════════════════════════════════════════════════
 *
 * קודם היו כאן "הרשמה" ו"התחברות", ומתג ביניהם. זה נשמע מסודר
 * ויוצר בעיה אמיתית: **המשתמש לא זוכר.** הוא לא יודע אם פתח
 * כאן חשבון לפני חודשיים או לא, והוא לא אמור לדעת.
 *
 * מי שבוחר לא נכון מקבל שגיאה שמאשימה אותו במשהו שהוא לא עשה —
 * "החשבון כבר קיים" או "לא נמצא חשבון" — ואז הוא מנסה את
 * השני, ובינתיים כבר לא בטוח שהוא במקום הנכון.
 *
 * ★ עכשיו: כפתור אחד, "המשך עם גוגל". יש חשבון — נכנסים אליו.
 *   אין — נוצר. אותה לחיצה, אותה תוצאה מבחינת המשתמש.
 *
 * ★★ ומה עם ההרכבים שבנה כאורח לפני שהתחבר?
 *
 * לפני היציאה לגוגל מונפק אסימון העברה, ואחרי החזרה הוא נפדה
 * אוטומטית — הדאטה עוברת אל החשבון שנחתנו בו. המשתמש לא רואה
 * את זה ולא צריך לדעת שזה קרה. ראו `continueWithGoogle`.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ מה שאין כאן, ובכוונה
 * ═══════════════════════════════════════════════════════════════
 *
 * **אין מסך חסימה.** הקומפוננטה הזו לא מרונדרת אף פעם כשער
 * כניסה. היא חיה בתוך הפרופיל, שנפתח בלחיצה. אורח שלא ייגע בה
 * ישחק מחזור שלם.
 *
 * **אין שם משתמש וקוד הפניה בטופס.** הם היו ארבעה שדות מול
 * מישהו שרק רצה לשמור הרכב. שם המאמן נערך בפרופיל, אחר כך,
 * כשהוא כבר בפנים.
 */
import { useState } from 'react';
import {
  continueWithGoogle, continueWithEmail, verifyEmailCode, refreshIdentity,
  authMessageHe,
} from '../lib/identity.ts';
import { OFFSIDES } from '../lib/growth.ts';

export function AuthPanel({ onDone }: { onDone?: () => void }) {
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const google = () => {
    setBusy(true); setError(null);
    void continueWithGoogle()
      .catch((e: unknown) => {
        setError(authMessageHe(e instanceof Error ? e.message : ''));
        setBusy(false);
      });
    /* ★ אין `finally`: הצלחה = ניווט החוצה, והמסך הזה מת.
       איפוס `busy` היה מהבהב את הכפתור בדיוק לפני העזיבה. */
  };

  /* ---------------- אחרי שליחת המייל ---------------- */
  if (sent) {
    return (
      <div className="rounded-2xl bg-night-2 p-5 edge-gold">
        <h3 className="text-center font-press text-base font-black text-chalk">
          שלחנו לך מייל
        </h3>
        <p className="mt-1.5 text-center text-[12.5px] leading-snug text-chalk-2">
          ל־<bdi dir="ltr" className="font-bold text-chalk">{email.trim()}</bdi>
        </p>

        {/*
          ★ הקישור הוא הדרך הראשית, לא הקוד.

          תבנית המייל של Supabase, כברירת מחדל, מכילה **רק
          קישור**. מסך שכתוב בו "הקלידו את הקוד" שולח את
          המשתמש לחפש משהו שלא קיים במייל — הוא יחפש, לא ימצא,
          ויסיק שהוא עשה משהו לא נכון.
        */}
        <ol className="mt-4 space-y-2 text-[12.5px] leading-snug text-chalk-2">
          <li className="flex gap-2">
            <span className="num shrink-0 text-gold">1.</span>
            <span>לפתוח את המייל וללחוץ על הקישור.</span>
          </li>
          <li className="flex gap-2">
            <span className="num shrink-0 text-gold">2.</span>
            <span>לחזור לכאן וללחוץ על הכפתור.</span>
          </li>
        </ol>

        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true); setError(null);
            void refreshIdentity()
              .then((id) => {
                if (id && !id.isGuest) { onDone?.(); return; }
                setError('עוד לא ראינו את האישור. אם לחצתם על הקישור — נסו שוב בעוד רגע.');
              })
              .finally(() => setBusy(false));
          }}
          className="tap mt-4 w-full rounded-full bg-gradient-to-b from-gold-light to-gold
                     py-2.5 font-poster text-gold-ink disabled:opacity-40"
        >
          {busy ? 'בודק…' : 'לחצתי על הקישור'}
        </button>

        <details className="mt-3">
          <summary className="cursor-pointer text-center text-[11.5px] text-chalk-dim
                              underline underline-offset-2">
            יש לי קוד, או שאני מעדיף להדביק את הקישור
          </summary>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            dir="ltr"
            placeholder="000000  או  הדבקת הקישור"
            className="mt-2 w-full rounded-xl border border-gold/25 bg-night px-3 py-2.5
                       text-center text-[13px] text-chalk outline-none focus:border-gold"
          />
          <button
            type="button"
            disabled={busy || token.trim().length < 6}
            onClick={() => {
              setBusy(true); setError(null);
              void verifyEmailCode(email, token)
                .then(() => onDone?.())
                .catch((e: unknown) =>
                  setError(authMessageHe(e instanceof Error ? e.message : '')))
                .finally(() => setBusy(false));
            }}
            className="tap mt-2 w-full rounded-full border border-gold/35 py-2
                       text-[13px] font-bold text-gold-light disabled:opacity-40"
          >
            {busy ? 'מאמת…' : 'אימות'}
          </button>
        </details>

        {error && (
          <p role="alert" className="mt-3 rounded-xl border border-flare/40 bg-flare/10 px-3 py-2
                                     text-center text-[12px] font-bold text-flare">
            {error}
          </p>
        )}

        {/* ★ מונע נטישה, וגם נכון: המיזוג קורה אחרי ההתחברות. */}
        <p className="mt-3 rounded-xl bg-night px-3 py-2 text-center text-[11.5px] text-chalk-dim">
          ההרכבים והדירוג שלך עוברים איתך.
        </p>

        <button
          type="button"
          onClick={() => { setSent(false); setToken(''); setError(null); }}
          className="mt-2 w-full text-center text-[11.5px] text-chalk-dim underline underline-offset-2"
        >
          לשנות כתובת
        </button>
      </div>
    );
  }

  /* ---------------- הבחירה ---------------- */
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={google}
        disabled={busy}
        className="tap flex w-full items-center justify-center gap-2.5 rounded-full
                   bg-chalk px-4 py-3 font-black text-night transition-transform
                   duration-200 ease-brand active:scale-[.99] disabled:opacity-50"
      >
        <GoogleG />
        {busy ? 'רגע…' : 'המשך עם גוגל'}
      </button>

      {!emailOpen ? (
        <>
          <div className="flex items-center gap-3 py-0.5">
            <span className="h-px flex-1 bg-gold/15" />
            <span className="text-[10px] font-black text-chalk-dim">או</span>
            <span className="h-px flex-1 bg-gold/15" />
          </div>

          <button
            type="button"
            onClick={() => setEmailOpen(true)}
            className="tap flex w-full items-center justify-center gap-2 rounded-full
                       border border-gold/30 px-4 py-3 font-black text-gold-light
                       transition-colors duration-200 ease-brand active:bg-gold/10"
          >
            <span aria-hidden>✉</span> המשך עם אימייל
          </button>
        </>
      ) : (
        <div className="rounded-2xl bg-night-2 p-3 edge-gold">
          <label className="block">
            <span className="text-[11px] text-chalk-dim">המייל שלך</span>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="mt-1 w-full rounded-xl border border-gold/25 bg-night px-3 py-2.5
                         text-chalk outline-none focus:border-gold"
            />
          </label>
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              disabled={busy || !email.includes('@')}
              onClick={() => {
                setBusy(true); setError(null);
                void continueWithEmail(email)
                  .then(() => setSent(true))
                  .catch((e: unknown) =>
                    setError(authMessageHe(e instanceof Error ? e.message : '')))
                  .finally(() => setBusy(false));
              }}
              className="tap flex-1 rounded-full bg-gradient-to-b from-gold-light to-gold
                         py-2.5 font-poster text-gold-ink disabled:opacity-40"
            >
              {busy ? 'שולח…' : 'שליחה'}
            </button>
            <button
              type="button"
              onClick={() => setEmailOpen(false)}
              className="tap rounded-full border border-gold/25 px-4 text-[12.5px] text-chalk-dim"
            >
              ביטול
            </button>
          </div>
        </div>
      )}

      {/* ★ שורה אחת שמחליפה לשונית שלמה: מרגע ששני המוצרים
          חולקים OAuth client אחד, זה באמת אותו כפתור. */}
      <p className="pt-0.5 text-center text-[11px] leading-snug text-chalk-dim">
        יש לכם כבר חשבון ב{OFFSIDES.nameHe}? זה אותו כפתור — אותה זהות.
      </p>

      {error && (
        <p role="alert" className="rounded-xl border border-flare/40 bg-flare/10 px-3 py-2
                                   text-center text-[12px] font-bold text-flare">
          {error}
        </p>
      )}
    </div>
  );
}

/** הלוגו של גוגל בצבעים הרשמיים. גרסה חד־צבעית נראית כמו זיוף. */
function GoogleG() {
  return (
    <svg viewBox="0 0 18 18" width="17" height="17" aria-hidden="true" className="shrink-0">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.35 0-4.34-1.58-5.05-3.71H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.95 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l2.99-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l2.99 2.33C4.66 5.16 6.65 3.58 9 3.58z" />
    </svg>
  );
}
