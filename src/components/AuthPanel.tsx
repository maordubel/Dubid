/**
 * components/AuthPanel.tsx — הרשמה והתחברות.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ הסדר על המסך הוא ההחלטה
 * ═══════════════════════════════════════════════════════════════
 *
 *      גוגל            ← לחיצה אחת. זה מה שרוב האנשים יעשו.
 *      ── או ──
 *      אימייל          ← מקופל. נפתח רק למי שרוצה אותו.
 *
 * הטופס המלא — שם משתמש, קוד הפניה, מייל, סיסמה — הוא ארבעה
 * שדות. ארבעה שדות פתוחים מול מישהו שרק רצה לשמור הרכב הם קיר.
 * מקופל, הם בחירה של מי שמעדיף אותם.
 *
 * המבנה זהה לטופס של אופסיידס (`DUBIDAUTHSYNC.md` §5) — אותם
 * שדות, אותו סדר, אותה מטא־דאטה. לא כדי לחסוך עבודה, אלא כדי
 * שמשתמש שמכיר מוצר אחד לא יצטרך ללמוד את השני.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ מה שאין כאן, ובכוונה
 * ═══════════════════════════════════════════════════════════════
 *
 * **אין מסך חסימה.** הקומפוננטה הזו לא מרונדרת אף פעם כשער
 * כניסה. היא חיה בתוך גיליון החשבון, שנפתח בלחיצה. אורח שלא
 * ייגע בה ישחק מחזור שלם.
 *
 * **אין "שכחתי סיסמה".** עוד לא — הוא דורש תבנית מייל מוגדרת
 * בפרויקט, ובלעדיה הכפתור שולח לשום מקום. עדיף שלא יהיה כפתור
 * מאשר שיהיה כפתור ששקר.
 */
import { useEffect, useState } from 'react';
import { OFFSIDES } from '../lib/growth.ts';
import {
  signUpWithEmail, signInWithEmail, signInWithGoogle,
  upgradeStart, upgradeVerify, upgradeWithGoogle, refreshIdentity,
  currentIdentity, suggestUsername, referralFromUrl, authMessageHe,
} from '../lib/identity.ts';

type Mode = 'signup' | 'signin';

export function AuthPanel({ onDone }: { onDone?: () => void }) {
  const [mode, setMode] = useState<Mode>('signup');
  const [emailOpen, setEmailOpen] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [ref, setRef] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  /*
   * ═══════════════════════════════════════════════════════════
   * ★★★ אורח משדרג, הוא לא נרשם מחדש ★★★
   * ═══════════════════════════════════════════════════════════
   *
   * ההבדל הזה הוא הבאג החמור ביותר שהיה במוצר.
   *
   * `signUp()` על סשן אנונימי **יוצר משתמש חדש** עם uid חדש.
   * כלומר אורח שבנה הרכב, נעל אותו, וקיבל דירוג — ואז לחץ
   * "שמור את החשבון שלי" — קיבל חשבון ריק, וההיסטוריה שלו
   * נשארה תלויה על משתמש שאי אפשר להתחבר אליו יותר.
   *
   * זה הרס בדיוק את מה שההרשמה הבטיחה להגן עליו, ובשקט: בלי
   * שגיאה ובלי אזהרה. המשתמש פשוט ראה טבלה ריקה.
   *
   * לכן: אורח → `upgradeStart` + `upgradeVerify` (אותו uid).
   *      מי שכבר רשום ורק מתחבר מחדש → `signIn` כרגיל.
   */
  const isGuest = currentIdentity()?.isGuest !== false;

  /** שלב אימות הקוד בשדרוג. `null` = עוד לא נשלח. */
  const [otpTo, setOtpTo] = useState<string | null>(null);
  const [otp, setOtp] = useState('');

  /**
   * ★ `?ref=CODE` ממלא את קוד ההפניה **וגם** מכריח מצב הרשמה.
   * מי שהגיע מקישור הזמנה בא כדי להצטרף, לא כדי להתחבר.
   */
  useEffect(() => {
    const code = referralFromUrl();
    if (code) { setRef(code); setMode('signup'); }
  }, []);

  /**
   * ★ שם מוצע ברגע שהטופס נפתח.
   *
   * "בחר שם משתמש" הוא השדה שהכי הרבה אנשים נתקעים בו, והוא לא
   * שדה חשוב. הצעה שאפשר להחליף מורידה את המחסום לאפס בלי לקחת
   * מאף אחד את הבחירה.
   */
  useEffect(() => {
    if (!emailOpen || mode !== 'signup' || username) return;
    void suggestUsername().then((s) => { if (s) setUsername(s); });
  }, [emailOpen, mode, username]);

  const google = () => {
    setError(null);
    setBusy(true);
    /* ★ `linkIdentity` לאורח, `signInWithOAuth` למי שמתחבר מחדש.
       אותו כפתור, שתי פעולות שונות לגמרי — ראו ההסבר למעלה. */
    const run = isGuest && mode === 'signup' ? upgradeWithGoogle : signInWithGoogle;
    void run()
      .catch((e: unknown) => setError(authMessageHe(e instanceof Error ? e.message : '')))
      .finally(() => setBusy(false));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);

    void (async () => {
      try {
        if (mode === 'signup' && isGuest) {
          /* שדרוג: אותו משתמש, אותה היסטוריה. הקוד מגיע למייל. */
          await upgradeStart(email);
          setOtpTo(email.trim().toLowerCase());
        } else if (mode === 'signup') {
          const res = await signUpWithEmail({
            email, password, username, referralCode: ref,
          });
          if (res.needsEmailConfirmation) setSentTo(email.trim());
          else onDone?.();
        } else {
          await signInWithEmail(email, password);
          onDone?.();
        }
      } catch (err) {
        setError(authMessageHe(err instanceof Error ? err.message : ''));
      } finally {
        setBusy(false);
      }
    })();
  };

  /* ---- שדרוג: הקוד שהגיע למייל ---- */
  /*
   * ★ קוד, ולא רק קישור.
   *
   * Supabase שולחת גם קישור וגם קוד. הקישור פותח **לשונית
   * חדשה**, ובלשונית חדשה הסשן האנונימי הוא לא בהכרח אותו סשן —
   * ובמובייל זה בכלל דפדפן אחר לפעמים. קוד שמוקלד כאן, בלשונית
   * שבה המשתמש כבר יושב, הוא הדרך היחידה שמובטח שהיא משדרגת
   * את החשבון הנכון.
   */
  if (otpTo) {
    return (
      <div className="rounded-2xl bg-night-2 p-5 edge-gold">
        <h3 className="text-center font-press text-base font-black text-chalk">
          שלחנו לך מייל
        </h3>
        <p className="mt-1.5 text-center text-[12.5px] leading-snug text-chalk-2">
          ל־<bdi dir="ltr" className="font-bold text-chalk">{otpTo}</bdi>
        </p>

        {/*
          ═══════════════════════════════════════════════════════
          ★★★ שתי דרכים, כי במייל יש רק אחת מהן ★★★
          ═══════════════════════════════════════════════════════

          תבנית המייל של Supabase, כברירת מחדל, מכילה **רק
          קישור**. קוד בן שש ספרות מופיע רק אם מוסיפים ידנית
          `{{ .Token }}` לתבנית.

          מסך שכתוב בו "הקלידו את הקוד" מול תבנית ברירת מחדל
          שולח את המשתמש לחפש משהו שלא קיים במייל. הוא יחפש,
          לא ימצא, ויסיק שהוא עשה משהו לא נכון.

          לכן הקישור הוא הדרך **הראשית** — הוא תמיד שם — והקוד
          הוא האפשרות המשנית.
        */}
        <ol className="mt-4 space-y-2 text-[12.5px] leading-snug text-chalk-2">
          <li className="flex gap-2">
            <span className="num shrink-0 text-gold">1.</span>
            <span>לפתוח את המייל וללחוץ על הקישור שבו.</span>
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

        {/* ---- הדרך המשנית ---- */}
        <details className="mt-3">
          <summary className="cursor-pointer text-center text-[11.5px] text-chalk-dim
                              underline underline-offset-2">
            יש לי קוד, או שאני מעדיף להדביק את הקישור
          </summary>

          <input
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            dir="ltr"
            placeholder="000000  או  הדבקת הקישור מהמייל"
            className="mt-2 w-full rounded-xl border border-gold/25 bg-night px-3 py-2.5
                       text-center text-[13px] text-chalk outline-none focus:border-gold"
          />
          <button
            type="button"
            disabled={busy || otp.trim().length < 6}
            onClick={() => {
              setBusy(true); setError(null);
              void upgradeVerify(otpTo, otp)
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

        {/* ★ המשפט הזה מונע נטישה, והוא גם נכון.
            השדרוג לא נוגע בהרכבים — זה בדיוק ההבדל בין
            `updateUser` לבין `signUp`. */}
        <p className="mt-3 rounded-xl bg-night px-3 py-2 text-center text-[11.5px] text-chalk-dim">
          ההרכבים, שם הקבוצה והדירוג שלך נשארים בדיוק כמו שהם.
          החשבון רק מקבל מייל.
        </p>

        <button
          type="button"
          onClick={() => { setOtpTo(null); setOtp(''); setError(null); }}
          className="mt-2 w-full text-center text-[11.5px] text-chalk-dim underline underline-offset-2"
        >
          לשנות כתובת
        </button>
      </div>
    );
  }

  /* ---- אחרי הרשמה שדורשת אימות ---- */
  if (sentTo) {
    return (
      <div className="rounded-2xl bg-night-2 p-5 text-center edge-gold">
        <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full
                        bg-gold/12 text-2xl ring-1 ring-inset ring-gold/30">
          ✉
        </div>
        <h3 className="font-press text-base font-black text-chalk">שלחנו לך מייל</h3>
        <p className="mt-1.5 text-[12.5px] leading-snug text-chalk-2">
          לחצו על הקישור שנשלח ל<bdi dir="ltr" className="font-bold text-chalk">{sentTo}</bdi>{' '}
          כדי לאשר את החשבון. הקישור מחזיר בדיוק לכאן.
        </p>
        {/* ★ המשפט הזה הוא לא נימוס — הוא מונע נטישה.
            משתמש שלא בטוח מה קרה להרכב שלו בזמן שהוא בודק מייל,
            עלול לפתוח את האפליקציה מחדש ולנסות להתחיל מהתחלה. */}
        <p className="mt-3 rounded-xl bg-night px-3 py-2 text-[11.5px] text-chalk-dim">
          ההרכב שלך שמור. אפשר להמשיך לשחק גם עכשיו — האישור רק
          מקבע את החשבון.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!emailOpen ? (
        <>
          <button
            type="button"
            onClick={google}
            disabled={busy}
            className="tap flex w-full items-center justify-center gap-2.5 rounded-full
                       bg-chalk px-4 py-3 font-black text-night transition-transform
                       duration-200 ease-brand active:scale-[.99] disabled:opacity-50"
          >
            <GoogleG />
            {busy ? 'רגע…'
              : isGuest && mode === 'signup' ? 'שמירה עם גוגל' : 'המשך עם גוגל'}
          </button>

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
            <span aria-hidden>✉</span>{' '}
            {isGuest && mode === 'signup' ? 'שמירה עם אימייל' : 'המשך עם אימייל'}
          </button>

          {/*
            ★ שורה אחת שמחליפה לשונית שלמה.

            הייתה כאן לשונית "אופסיידס" שביקשה מייל, שלחה קוד,
            ואימתה מול הפרויקט השני — שלושה מסכים ושני מקומות
            שאפשר להיתקע בהם.

            מרגע ששני המוצרים חולקים OAuth client אחד, התשובה
            האמיתית היא משפט: זה אותו כפתור. משתמש שיודע את זה
            לא צריך שום מסך נוסף.
          */}
          <p className="pt-0.5 text-center text-[11px] leading-snug text-chalk-dim">
            יש לכם כבר חשבון ב{OFFSIDES.nameHe}? היכנסו עם אותו חשבון
            גוגל — זו אותה זהות.
          </p>
        </>
      ) : (
        <form onSubmit={submit} className="space-y-2.5">
          <button
            type="button"
            onClick={() => setEmailOpen(false)}
            className="text-[11px] text-chalk-dim underline underline-offset-2"
          >
            → חזרה
          </button>

          {mode === 'signup' && !isGuest && (
            <>
              <Field label="שם משתמש">
                <div className="flex gap-2">
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="איך יקראו לך בטבלה"
                    autoComplete="username"
                    className={inputCls}
                  />
                  <button
                    type="button"
                    aria-label="הצעה אחרת"
                    onClick={() => { void suggestUsername().then((s) => s && setUsername(s)); }}
                    className="tap shrink-0 rounded-xl border border-gold/25 px-3 text-lg"
                  >
                    🎲
                  </button>
                </div>
              </Field>

              <Field label="קוד הפניה" hint="לא חובה">
                <input
                  value={ref}
                  onChange={(e) => setRef(e.target.value.toUpperCase())}
                  maxLength={16}
                  dir="ltr"
                  placeholder="ABC12345"
                  className={`${inputCls} num text-center tracking-[0.2em]`}
                />
              </Field>
            </>
          )}

          <Field label="אימייל">
            <input
              type="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
              className={inputCls}
            />
          </Field>

          {/*
            ★ אורח שמשדרג לא מקליד סיסמה, וזו לא בחירה שלנו:
            Supabase לא מאפשרת לקבוע סיסמה לפני שהמייל אומת.

            וזה גם עדיף. שדה אחד במקום ארבעה, והכניסה בפעם הבאה
            היא קוד למייל — מה שרוב האנשים ממילא מעדיפים על
            סיסמה שהם ישכחו.
          */}
          {!(mode === 'signup' && isGuest) && (
            <Field label="סיסמה">
              <input
                type="password"
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="שישה תווים לפחות"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                required
                className={inputCls}
              />
            </Field>
          )}

          {error && (
            <p role="alert" className="rounded-xl border border-flare/40 bg-flare/10 px-3 py-2
                                       text-center text-[12px] font-bold text-flare">
              {error}
            </p>
          )}

          {/* ★ הכפתור לא דורש סיסמה במסלול השדרוג — שם אין שדה
              סיסמה בכלל, ותנאי `!password` היה נועל אותו לנצח. */}
          <button
            type="submit"
            disabled={busy || !email || (!password && !(mode === 'signup' && isGuest))}
            className="tap w-full rounded-full bg-gradient-to-b from-gold-light to-gold
                       py-3 font-poster text-gold-ink disabled:opacity-40"
          >
            {busy ? '…'
              : mode === 'signin' ? 'התחברות'
                /* ★ "שמירת החשבון" ולא "יצירת חשבון".
                   האורח לא יוצר שום דבר — יש לו כבר חשבון, עם
                   הרכב ודירוג. הוא רק מוסיף לו דרך להיכנס. */
                : isGuest ? 'שמירת החשבון שלי' : 'יצירת חשבון'}
          </button>

          <button
            type="button"
            onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setError(null); }}
            className="w-full text-center text-[11.5px] text-chalk-dim underline underline-offset-2"
          >
            {mode === 'signup' ? 'כבר יש לי חשבון' : 'לשמור את החשבון הנוכחי'}
          </button>
        </form>
      )}

      {error && !emailOpen && (
        <p role="alert" className="rounded-xl border border-flare/40 bg-flare/10 px-3 py-2
                                   text-center text-[12px] font-bold text-flare">
          {error}
        </p>
      )}
    </div>
  );
}

/* ================================================================== */

const inputCls =
  'w-full min-w-0 rounded-xl border border-gold/25 bg-night px-3 py-2.5 text-chalk ' +
  'outline-none transition-colors focus:border-gold disabled:opacity-50';

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline gap-1.5">
        <span className="text-[10px] font-black uppercase tracking-[0.16em] text-chalk-dim">
          {label}
        </span>
        {hint && <span className="text-[10px] text-chalk-dim/70">{hint}</span>}
      </span>
      {children}
    </label>
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
