/**
 * components/AccountSheet.tsx — פרופיל המאמן.
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
  currentIdentity, redeemAccessCode,
  setDisplayName, storedDisplayName, myProfile, setAvatar, AVATAR_POOL,
  signOut, type Identity, type CoachProfile,
} from '../lib/identity.ts';
import { AuthPanel } from './AuthPanel.tsx';
import { LogoMark } from './Logo.tsx';

type Tab = 'me' | 'move';

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
        aria-label="פרופיל המאמן"
        onClick={(e) => e.stopPropagation()}
        className="tex-wood max-h-[92dvh] w-full max-w-lg animate-slideUp overflow-y-auto
                   rounded-t-3xl border-t border-gold/25 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
      >
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-gold/15
                        bg-night/85 px-4 py-3 backdrop-blur">
          <LogoMark size={28} />
          <h2 className="flex-1 font-press text-lg font-black text-chalk">פרופיל המאמן</h2>
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
          {/* ★ שתי לשוניות, לא שלוש. ראו את ההערה על הסרת
              לשונית אופסיידס בתחתית הקובץ. */}
          {([['me', 'פרופיל המאמן'], ['move', 'הכרטיס שלי']] as const)
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
          {tab === 'me' && <ProfileTab identity={identity} onShowPass={onShowPass} />}
          {tab === 'move' && (
            <MoveTab onDone={onClose} onShowPass={onShowPass} hasPass={hasPass} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */

/* ================================================================== */
/* פרופיל המאמן                                                        */
/* ================================================================== */

/**
 * ═══════════════════════════════════════════════════════════════
 * ★★★ למה המסך הזה קיים ★★★
 * ═══════════════════════════════════════════════════════════════
 *
 * משתמש שנכנס עם גוגל ראה בדיוק את מה שראה קודם: אותו לובי,
 * אותו שם. שום סימן שמשהו השתנה — ולכן ההתחברות הרגישה כמו
 * טופס שמילא בשביל כלום.
 *
 * ★ וזו לא בעיה קוסמטית אלא בעיה של **תמורה**.
 *
 * אנחנו מבקשים מאדם לוותר על אנונימיות. אם מה שהוא מקבל בתמורה
 * בלתי נראה, הבקשה הבאה שלנו תיענה בפחות נכונות — והוא צודק.
 *
 * הפרופיל הוא התמורה: מקום שבו **מצטבר** מה שעשית. ככל שיש בו
 * יותר, כך פחות רוצים לאבד אותו — וזה מה שהופך חשבון מ"טופס"
 * ל"דבר ששייך לי".
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ שלוש החלטות
 * ═══════════════════════════════════════════════════════════════
 *
 * **1. גם לאורח יש פרופיל.**
 *    הוא לא מסך שנפתח אחרי הרשמה — הוא מסך שקיים תמיד, ומתמלא
 *    ככל שמשחקים. אורח שרואה שכבר הצטברו לו שלושה מחזורים מבין
 *    לבד מה הוא עומד לאבד. זה משכנע יותר מכל משפט שנכתוב.
 *
 * **2. אין מספרים מומצאים.**
 *    מחזור שלא נוקד מציג "—" ולא 0. אפס נראה כמו כישלון; מקף
 *    נראה כמו "עוד לא". במסך שכל תפקידו לגרום למישהו להרגיש
 *    טוב עם מה שבנה, ההבדל הזה הוא הכל.
 *
 * **3. האווטאר נבחר, לא מוגרל.**
 *    בחירה קטנה היא בעלות. מי שבחר את הפרצוף שלו התחיל להשקיע,
 *    ומי שהשקיע נשאר.
 */
function ProfileTab({
  identity, onShowPass,
}: { identity: Identity | null; onShowPass?: () => void }) {
  const [p, setP] = useState<CoachProfile | null>(null);
  const [name, setName] = useState(storedDisplayName());
  const [saved, setSaved] = useState(false);
  const [pickAvatar, setPickAvatar] = useState(false);
  const guest = identity?.isGuest !== false;

  useEffect(() => { void myProfile().then(setP); }, [identity?.id]);

  const avatar = p?.avatar || identity?.avatar || '⚽';

  return (
    <div className="space-y-4">
      {/* ═══════════ הכותרת — מי אתה ═══════════ */}
      <section className="rounded-2xl bg-night-2 p-4 edge-gold">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setPickAvatar((v) => !v)}
            aria-label="שינוי אווטאר"
            className="tap grid size-16 shrink-0 place-items-center rounded-2xl bg-night
                       text-3xl ring-1 ring-inset ring-gold/30"
          >
            {avatar}
          </button>

          <div className="min-w-0 flex-1">
            <h3 className="font-press truncate text-[19px] font-black leading-tight text-chalk">
              {p?.displayName || name || 'מאמן'}
            </h3>
            {p?.username && (
              <p className="truncate text-[12px] text-chalk-dim">
                <bdi dir="ltr">@{p.username}</bdi>
              </p>
            )}
            <p className="mt-1 flex flex-wrap items-center gap-1.5">
              <span
                className={`rounded px-1.5 py-px text-[9.5px] font-black ${
                  guest ? 'bg-chalk/10 text-chalk-dim' : 'bg-gold/20 text-gold'}`}
              >
                {guest ? 'אורח' : 'חשבון קבוע'}
              </span>
              {p?.hasPass && (
                <span className="rounded bg-gold/12 px-1.5 py-px text-[9.5px] font-black text-gold">
                  יש כרטיס
                </span>
              )}
              {p && (
                <span className="text-[10.5px] text-chalk-dim">
                  מאמן מאז{' '}
                  <span className="num">
                    {new Date(p.memberSince).toLocaleDateString('he-IL', {
                      month: '2-digit', year: 'numeric', timeZone: 'Asia/Jerusalem',
                    })}
                  </span>
                </span>
              )}
            </p>
          </div>
        </div>

        {pickAvatar && (
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-gold/12 pt-3">
            {AVATAR_POOL.map((a) => (
              <button
                key={a}
                onClick={() => {
                  setPickAvatar(false);
                  setP((x) => (x ? { ...x, avatar: a } : x));
                  void setAvatar(a);
                }}
                className={`tap grid size-11 place-items-center rounded-xl text-xl
                            ${a === avatar ? 'bg-gold/20 ring-1 ring-gold' : 'bg-night'}`}
              >
                {a}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ═══════════ מה עשית ═══════════ */}
      {/*
        ★ ארבעה מספרים, ולא שמונה.

        פרופיל עמוס נקרא כדוח. ארבעה מספרים גדולים נקראים
        כהישג — וזה מה שהמסך הזה אמור לעשות.
      */}
      <section className="grid grid-cols-4 gap-2">
        <Metric label="מחזורים" value={p?.played ?? 0} />
        <Metric label="נקודות" value={p?.totalPoints ?? null} />
        <Metric label="שיא" value={p?.bestPoints ?? null} />
        <Metric label="מקום הכי טוב" value={p?.bestRank ?? null} prefix="#" />
      </section>

      {p && p.played === 0 && (
        <p className="rounded-xl border border-gold/15 bg-night-2 px-3 py-3 text-center
                      text-[12px] leading-snug text-chalk-dim">
          עוד לא הגשת הרכב. ברגע שתגיש, המחזור יופיע כאן —
          וההיסטוריה שלך מתחילה להצטבר.
        </p>
      )}

      {/* ═══════════ ההיסטוריה ═══════════ */}
      {p && p.history.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-gold/15 bg-night-2">
          <div className="flex items-baseline justify-between border-b border-gold/15 px-4 py-2.5">
            <span className="text-[11px] font-black tracking-[2px] text-gold">
              ההיסטוריה שלי
            </span>
            <span className="text-[10.5px] text-chalk-dim">
              <span className="num">{p.played}</span> הגשות
            </span>
          </div>
          <ul>
            {p.history.map((h) => (
              <li
                key={`${h.gw}-${h.mode}`}
                className="flex items-center gap-3 border-b border-gold/10 px-4 py-2.5 last:border-0"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-black text-chalk">
                    {h.teamName || h.gwLabel}
                  </span>
                  <span className="block truncate text-[10.5px] text-chalk-dim">
                    {h.gwLabel} · {h.mode === 'five' ? 'דוביד 5' : 'דוביד 11'}
                    {h.rank && <> · מקום <span className="num">{h.rank}</span></>}
                  </span>
                </span>
                {/* ★ מקף ולא אפס. מחזור שלא נוקד הוא "עוד לא",
                    לא "נכשלת". */}
                <span className="num shrink-0 text-[15px] text-gold-light">
                  {h.points === null ? <span className="text-chalk-dim">—</span> : h.points}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ═══════════ השם ═══════════ */}
      <section className="rounded-2xl bg-night-2 p-4 edge-gold">
        <h3 className="text-sm font-black text-chalk">שם המאמן</h3>
        <p className="mt-1 text-[12px] leading-snug text-chalk-2">
          זה מה שמופיע בטבלה ובכרטיס השיתוף.
        </p>
        <div className="mt-2.5 flex gap-2">
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); setSaved(false); }}
            maxLength={20}
            placeholder="איך יקראו לך בטבלה"
            className="min-w-0 flex-1 rounded-xl border border-gold/25 bg-night px-3 py-2.5
                       text-chalk outline-none focus:border-gold"
          />
          <button
            onClick={() => {
              void setDisplayName(name).then(() => {
                setSaved(true);
                void myProfile().then(setP);
              });
            }}
            disabled={!name.trim()}
            className="tap shrink-0 rounded-xl bg-gold px-4 text-[13px] font-black
                       text-gold-ink disabled:opacity-40"
          >
            {saved ? 'נשמר ✓' : 'שמירה'}
          </button>
        </div>
      </section>

      {/* ═══════════ הרשמה — רק לאורח ═══════════ */}
      {guest && (
        <section>
          <div className="mb-2.5">
            <h3 className="font-press text-[15px] font-black text-chalk">
              שמירת החשבון
            </h3>
            {/*
              ★ הניסוח הזה עבר כמה גרסאות, וזו הנקודה.

              "הירשם עכשיו" מוכר משהו. תיאור של מצב — "ההרכבים
              שלך חיים בדפדפן הזה בלבד" — נותן למשתמש להחליט
              בעצמו. השנייה עובדת טוב יותר כי היא נכונה.

              ★★ ועכשיו יש לה גם עוגן: המספרים שמעל. אורח שרואה
              שהצטברו לו ארבעה מחזורים מבין לבד מה הוא עומד
              לאבד, וזה משכנע יותר מכל משפט.
            */}
            <p className="mt-1 text-[12.5px] leading-snug text-chalk-2">
              {p && p.played > 0
                ? `כבר יש כאן ${p.played} הגשות שלך. הן חיות בדפדפן הזה בלבד — חשבון שומר אותן לתמיד.`
                : 'עכשיו אתם משחקים כאורח, וזה בסדר גמור. רק שימו לב: הזהות הזו חיה בדפדפן הזה בלבד.'}
            </p>
          </div>
          <AuthPanel />
          <p className="mt-2.5 text-center text-[11px] text-chalk-dim">
            לא רוצים עכשיו? פשוט סגרו — הכל ממשיך לעבוד.
          </p>
        </section>
      )}

      {/* ═══════════ פעולות ═══════════ */}
      <section className="space-y-2">
        {onShowPass && (
          <button
            onClick={onShowPass}
            className="tap w-full rounded-xl border border-gold/25 py-2.5 text-[13px]
                       font-bold text-gold-light"
          >
            {p?.hasPass ? 'הכרטיס שלי' : 'קבלת כרטיס מנוי'}
          </button>
        )}

        {p?.referralCode && (
          <div className="rounded-xl bg-night-2 px-3 py-2.5 edge-gold">
            <div className="flex items-baseline gap-2">
              <span className="flex-1 text-[11px] text-chalk-dim">קוד ההפניה שלי</span>
              <span className="num text-[13px] font-black text-gold" dir="ltr">
                {p.referralCode}
              </span>
            </div>
          </div>
        )}

        {!guest && (
          <button
            onClick={() => { void signOut().then(() => window.location.reload()); }}
            className="tap w-full rounded-xl border border-flare/30 py-2.5 text-[12.5px]
                       font-bold text-flare"
          >
            יציאה מהחשבון
          </button>
        )}
      </section>
    </div>
  );
}

/** מספר גדול עם תווית קטנה. `null` = "עוד לא", ומוצג כמקף. */
function Metric({
  label, value, prefix = '',
}: { label: string; value: number | null; prefix?: string }) {
  return (
    <div className="rounded-xl border border-gold/12 bg-night-2 px-1 py-2.5 text-center">
      <div className="num text-[19px] leading-none text-gold">
        {value === null || value === undefined
          ? <span className="text-chalk-dim">—</span>
          : `${prefix}${value}`}
      </div>
      <div className="mt-1 text-[9.5px] leading-tight text-chalk-dim">{label}</div>
    </div>
  );
}

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

/**
 * ═══════════════════════════════════════════════════════════════
 * ★★★ כאן ישבה לשונית "אופסיידס", והיא הוסרה ★★★
 * ═══════════════════════════════════════════════════════════════
 *
 * היא נועדה לענות על "כבר יש לי חשבון באופסיידס, אל תבקשו ממני
 * להירשם מחדש". היא עשתה את זה דרך קוד למייל, וזה נשבר פעמיים:
 *
 *  · תבנית המייל של Supabase שולחת **קישור בלבד** כברירת מחדל,
 *    ולכן הקוד שהמסך ביקש פשוט לא היה במייל.
 *  · והקישור שכן הגיע הפנה ל**אופסיידס**, לא לדוביד — כלומר
 *    המשתמש נחת במוצר השני ולא קיבל כלום כאן.
 *
 * ★ ומה שחשוב מזה: היא כבר לא נחוצה.
 *
 * מרגע ששני המוצרים חולקים **OAuth client אחד** בגוגל, אותו
 * אדם נכנס לשניהם באותו חשבון גוגל, עם אותו מסך הסכמה, בלי
 * להישאל פעמיים ובלי סבב מייל בכלל. אותו מייל בשני הצדדים —
 * וזה בדיוק מה שהלשונית ניסתה להשיג, רק בשלושה מסכים יותר.
 *
 * הכלל: תכונה שנפתרה בדרך פשוטה יותר לא נשארת "ליתר ביטחון".
 * לשונית שבורה שמבטיחה משהו שלא קורה גרועה מהיעדרה.
 */
