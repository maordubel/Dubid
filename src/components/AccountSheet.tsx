/**
 * components/AccountSheet.tsx — החשבון שלי.
 *
 * ★ שלושה דברים, ובכוונה לא יותר
 *
 *   1. **קוד להעברה** — להמשיך במכשיר אחר.
 *   2. **הזנת קוד**   — להמשיך *מ*מכשיר אחר.
 *   3. **חשבון אופסיידס** — למי שכבר יש.
 *
 * מה שאין כאן: הרשמה, סיסמה, אימות מייל, "שכחתי". הכלל במוצר
 * הוא שנכנסים ומשחקים, והמסך הזה קיים כדי שהכלל הזה לא יעלה
 * למשתמש את ההיסטוריה שלו כשהוא מחליף מכשיר.
 *
 * ★ למה זה גיליון ולא מסך
 *
 * זה לא יעד. אף אחד לא פותח את דוביד כדי לנהל חשבון. גיליון
 * נפתח מעל מה שהיה, ונסגר בלי לאבד את המקום.
 */
import { useEffect, useState } from 'react';
import {
  currentIdentity, redeemAccessCode, authMessageHe,
  requestOffsidesCode, linkOffsidesAccount, setDisplayName, storedDisplayName,
  signOut, type Identity,
} from '../lib/identity.ts';
import { AuthPanel } from './AuthPanel.tsx';
import { OFFSIDES } from '../lib/growth.ts';
import { LogoMark } from './Logo.tsx';

type Tab = 'me' | 'move' | 'offsides';

export function AccountSheet({
  onClose, onShowPass, hasPass = false,
}: {
  onClose: () => void;
  /** פותח את כרטיס המנוי. מנפיק מפתח חדש — ראו `PassSheet`. */
  onShowPass?: () => void;
  hasPass?: boolean;
}) {
  const [tab, setTab] = useState<Tab>('me');
  const [identity, setIdentity] = useState<Identity | null>(currentIdentity());

  useEffect(() => { setIdentity(currentIdentity()); }, [tab]);

  return (
    <div
      className="fixed inset-0 z-sheet flex items-end justify-center bg-night/80 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-label="החשבון שלי"
        onClick={(e) => e.stopPropagation()}
        className="tex-wood max-h-[88dvh] w-full max-w-lg animate-slideUp overflow-y-auto
                   rounded-t-3xl border-t border-gold/25 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
      >
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-gold/15
                        bg-night/85 px-4 py-3 backdrop-blur">
          <LogoMark size={28} />
          <h2 className="flex-1 font-press text-lg font-black text-chalk">החשבון שלי</h2>
          <button
            onClick={onClose}
            aria-label="סגירה"
            className="tap grid size-9 place-items-center rounded-full text-chalk-dim"
          >
            ✕
          </button>
        </div>

        <div className="mx-4 mt-3 flex gap-1 rounded-full bg-night-2 p-1 edge-gold">
          {/* ★ "הכרטיס שלי" ולא "מכשיר חדש".
                התווית הישנה תיארה תרחיש; החדשה מתארת **חפץ
                שיש לי**. משתמש שמחפש איך לא לאבד את החשבון לא
                חושב "מכשיר חדש" — הוא חושב "איפה השמירה שלי". */}
          {([['me', 'החשבון'], ['move', 'הכרטיס שלי'], ['offsides', OFFSIDES.nameHe]] as const)
            .map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`tap flex-1 rounded-full py-1.5 text-[12.5px] font-black transition-colors
                            ${tab === id
                              ? 'bg-gradient-to-b from-gold-light to-gold text-gold-ink'
                              : 'text-chalk-dim'}`}
              >
                {label}
              </button>
            ))}
        </div>

        <div className="px-4 py-4">
          {tab === 'me' && <MeTab identity={identity} />}
          {tab === 'move' && (
            <MoveTab onDone={onClose} onShowPass={onShowPass} hasPass={hasPass} />
          )}
          {tab === 'offsides' && <OffsidesTab onDone={onClose} />}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */

function MeTab({ identity }: { identity: Identity | null }) {
  const [name, setName] = useState(storedDisplayName());
  const [saved, setSaved] = useState(false);
  const guest = identity?.isGuest !== false;

  return (
    <div className="space-y-4">
      {/*
        ★ הסדר כאן הוא ההצעה.

        לאורח, הדבר הראשון שהוא רואה הוא ההרשמה — כי זה מה שהוא
        בא לחפש אם הוא פתח את המסך הזה בכלל. למשתמש רשום, הדבר
        הראשון הוא השם שלו, כי אין לו מה לעשות עם טופס הרשמה.

        אותו מסך, שתי כוונות, בלי מסך נפרד לכל אחת.
      */}
      {guest && (
        <section>
          <div className="mb-2.5">
            <h3 className="font-press text-[15px] font-black text-chalk">
              שמירת החשבון
            </h3>
            {/*
              ★ הניסוח הזה עבר כמה גרסאות, וזו הנקודה.

              "הירשם עכשיו" מוכר משהו. "אתה משחק כאורח — ההרכבים
              שלך חיים בדפדפן הזה בלבד" מתאר מצב, ונותן למשתמש
              להחליט בעצמו אם הוא מפריע לו. השנייה עובדת טוב יותר
              כי היא נכונה.
            */}
            <p className="mt-1 text-[12.5px] leading-snug text-chalk-2">
              עכשיו אתם משחקים כאורח, וזה בסדר גמור. רק שימו לב:
              הזהות הזו חיה בדפדפן הזה בלבד. חשבון שומר את ההרכבים,
              הדירוג וההיסטוריה גם אם תנקו נתונים או תחליפו מכשיר.
            </p>
          </div>
          <AuthPanel />
          <p className="mt-2.5 text-center text-[11px] text-chalk-dim">
            לא רוצים עכשיו? פשוט סגרו — הכל ממשיך לעבוד.
          </p>
        </section>
      )}

      <label className="block">
        <span className="text-[11px] font-black uppercase tracking-[0.18em] text-chalk-dim">
          השם שלי בדירוג
        </span>
        <input
          value={name}
          onChange={(e) => { setName(e.target.value); setSaved(false); }}
          onBlur={() => { if (name.trim()) { void setDisplayName(name).then(() => setSaved(true)); } }}
          placeholder="איך יקראו לי בטבלה"
          className="mt-1.5 w-full rounded-xl border border-gold/25 bg-night px-3 py-2.5
                     text-chalk outline-none focus:border-gold"
        />
        {saved && <span className="mt-1 block text-[11px] text-gold">נשמר</span>}
      </label>

      <div className="rounded-2xl bg-night-2 p-4 edge-gold">
        <div className="flex items-start gap-3">
          {identity?.avatar && (
            <span className="grid size-10 shrink-0 place-items-center rounded-full
                             bg-night text-xl ring-1 ring-inset ring-gold/25">
              {identity.avatar}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-black uppercase tracking-[0.18em] text-chalk-dim">
              סוג החשבון
            </div>
            <div className="mt-0.5 text-sm font-bold text-chalk">
              {identity?.offsidesUserId
                ? `מקושר ל${OFFSIDES.nameHe}`
                : guest ? 'אורח — בלי הרשמה' : 'חשבון רשום'}
            </div>
            {identity?.username && (
              <div className="mt-0.5 truncate text-[12px] text-chalk-2">
                <bdi>{identity.username}</bdi>
              </div>
            )}
          </div>
        </div>

        <p className="mt-2.5 text-[12px] leading-snug text-chalk-2">
          {identity?.online
            ? 'ההרכבים והדירוג נשמרים בשרת, ולכן הם זהים בכל מכשיר שתיכנסו ממנו.'
            : 'אין כרגע חיבור לשרת. המשחק עובד, אבל הנתונים לא מסונכרנים בין מכשירים.'}
        </p>

        {identity?.referralCode && !guest && (
          <div className="mt-3 border-t border-gold/10 pt-3">
            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-chalk-dim">
              קוד ההפניה שלי
            </div>
            <div dir="ltr" className="num mt-0.5 text-lg text-gold-light">
              {identity.referralCode}
            </div>
          </div>
        )}
      </div>

      {!guest && (
        <button
          type="button"
          onClick={() => {
            if (window.confirm('לצאת מהחשבון? תחזרו לשחק כאורח.')) {
              void signOut().then(() => window.location.reload());
            }
          }}
          className="tap w-full rounded-full border border-chalk/15 py-2.5 text-[12.5px]
                     font-bold text-chalk-dim transition-colors active:bg-night-2"
        >
          יציאה מהחשבון
        </button>
      )}
    </div>
  );
}

/* ================================================================== */

function MoveTab({
  onDone, onShowPass, hasPass,
}: { onDone: () => void; onShowPass?: () => void; hasPass?: boolean }) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redeem = () => {
    setBusy(true); setError(null);
    void redeemAccessCode(input)
      .then((r) => {
        if (r.ok) { window.location.reload(); onDone(); return; }
        setError(r.error === 'TOO_MANY_ATTEMPTS'
          ? 'יותר מדי ניסיונות. נסו שוב בעוד רבע שעה.'
          : 'המפתח לא תקף. בדקו שהעתקתם אותו במלואו.');
      })
      .catch(() => setError('לא הצלחנו להתחבר לשרת. בדקו חיבור ונסו שוב.'))
      .finally(() => setBusy(false));
  };

  return (
    <div className="space-y-5">
      {/*
        ═══════════════════════════════════════════════════════
        ★★ מנגנון אחד, ולא שניים ★★
        ═══════════════════════════════════════════════════════

        כאן ישבו קודם שני דברים: "כרטיס מנוי" ו"קוד מהיר בן שש
        לשעה". שניהם פתרו את אותה בעיה בשתי דרכים, והמשתמש היה
        צריך להבין את ההבדל כדי לבחור — כלומר עוד החלטה, במסך
        שכל תפקידו הוא לא לאבד את החשבון.

        הכרטיס עושה את שניהם: אפשר לשמור אותו כתמונה, ואפשר
        פשוט להקליד את המפתח במכשיר שביד. הקוד הקצר ירד.
      */}
      {onShowPass && (
        <section className="rounded-2xl bg-night-2 p-4 edge-gold">
          <h3 className="text-sm font-black text-chalk">כרטיס המנוי שלי</h3>
          <p className="mt-1 text-[12px] leading-snug text-chalk-2">
            תמונה עם מפתח קבוע ו-QR. שומרים בגלריה או שולחים לעצמכם
            בוואטסאפ, ונכנסים איתה מכל מכשיר — בלי סיסמה ובלי הרשמה.
          </p>

          {hasPass && (
            /* ★ אזהרה אחת, ורק כשהיא רלוונטית.
               הנפקה מבטלת את הקודם — וזה בדיוק מה שהופך כרטיס
               ששמור בגלריה ללא תקף. עדיף שידע לפני ולא אחרי. */
            <p className="mt-2 rounded-lg border border-armband/30 bg-armband/10 px-2.5 py-2
                          text-[11.5px] leading-snug text-armband">
              כבר יש לכם כרטיס. הנפקת חדש תבטל את הישן — אם שמרתם
              אותו, הוא יפסיק לעבוד.
            </p>
          )}

          <button
            onClick={onShowPass}
            className="tap mt-3 w-full rounded-full bg-gradient-to-b from-gold-light to-gold
                       py-2.5 font-poster text-gold-ink"
          >
            {hasPass ? 'הנפקת כרטיס חדש' : 'קבלת הכרטיס שלי'}
          </button>
        </section>
      )}

      <section className="rounded-2xl bg-night-2 p-4 edge-gold">
        <h3 className="text-sm font-black text-chalk">יש לי כרטיס</h3>
        <p className="mt-1 text-[12px] leading-snug text-chalk-2">
          הקלידו את המפתח מהכרטיס, או סרקו את ה-QR שעליו. ההרכבים,
          שם הקבוצה והזירות שלכם יעברו למכשיר הזה.
        </p>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value.toUpperCase())}
          placeholder="XXXX-XXXX-XX"
          dir="ltr"
          maxLength={14}
          className="num mt-3 w-full rounded-xl border border-gold/25 bg-night px-3 py-2.5
                     text-center text-xl tracking-[0.25em] text-chalk outline-none focus:border-gold"
        />
        <button
          onClick={redeem}
          disabled={busy || input.replace(/[^A-Za-z0-9]/g, '').length < 6}
          className="tap mt-3 w-full rounded-full border border-gold/35 py-2.5
                     font-poster text-gold-light disabled:opacity-40"
        >
          {busy ? 'בודק…' : 'כניסה עם הכרטיס'}
        </button>
      </section>

      {error && (
        <p role="alert" className="rounded-xl border border-flare/40 bg-flare/10 px-3 py-2
                                   text-center text-[12px] font-bold text-flare">
          {error}
        </p>
      )}
    </div>
  );
}

function OffsidesTab({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = () => {
    setBusy(true); setError(null);
    void requestOffsidesCode(email)
      .then(() => setStage('code'))
      .catch(() => setError(
        `לא נמצא חשבון ${OFFSIDES.nameHe} עם המייל הזה, או שהשליחה נכשלה.`))
      .finally(() => setBusy(false));
  };

  const link = () => {
    setBusy(true); setError(null);
    void linkOffsidesAccount(email, otp)
      .then(() => { window.location.reload(); onDone(); })
      /* ★ הודעה שמבדילה בין "קוד שגוי" לבין "התכונה לא הופעלה".
         הודעה אחת לשני מצבים שולחת את המשתמש לבדוק את המייל
         שלו שוב ושוב על בעיה שהיא לא שלו. */
      .catch((e: unknown) => setError(authMessageHe(
        e instanceof Error ? e.message : '')))
      .finally(() => setBusy(false));
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-night-2 p-4 edge-gold">
        <h3 className="text-sm font-black text-chalk">
          כבר יש לי חשבון {OFFSIDES.nameHe}
        </h3>
        {/*
          ★ הניסוח כאן חשוב לא פחות מהקוד.
          "אותו חשבון" הוא ההבטחה. אם המשתמש יחשוב שהוא נרשם
          מחדש — הוא לא ילחץ.
        */}
        <p className="mt-1 text-[12px] leading-snug text-chalk-2">
          אותו חשבון, בלי הרשמה מחדש. נשלח קוד למייל שרשום
          ב{OFFSIDES.nameHe}, וזה כל מה שצריך.
        </p>

        {stage === 'email' ? (
          <>
            <input
              type="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="mt-3 w-full rounded-xl border border-gold/25 bg-night px-3 py-2.5
                         text-chalk outline-none focus:border-gold"
            />
            <button
              onClick={send}
              disabled={busy || !email.includes('@')}
              className="tap mt-3 w-full rounded-full bg-gradient-to-b from-gold-light to-gold
                         py-2.5 font-poster text-gold-ink disabled:opacity-40"
            >
              {busy ? 'שולח…' : 'שליחת קוד'}
            </button>
          </>
        ) : (
          <>
            <input
              dir="ltr"
              inputMode="numeric"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              maxLength={14}
              className="num mt-3 w-full rounded-xl border border-gold/25 bg-night px-3 py-2.5
                         text-center text-xl tracking-[0.3em] text-chalk outline-none
                         focus:border-gold"
            />
            <button
              onClick={link}
              disabled={busy || otp.length < 6}
              className="tap mt-3 w-full rounded-full bg-gradient-to-b from-gold-light to-gold
                         py-2.5 font-poster text-gold-ink disabled:opacity-40"
            >
              {busy ? 'מקשר…' : 'קישור החשבון'}
            </button>
            <button
              onClick={() => { setStage('email'); setOtp(''); }}
              className="mt-2 w-full text-center text-[11px] text-chalk-dim underline underline-offset-2"
            >
              מייל אחר
            </button>
          </>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-flare/40 bg-flare/10 px-3 py-2
                                   text-center text-[12px] font-bold text-flare">
          {error}
        </p>
      )}
    </div>
  );
}
