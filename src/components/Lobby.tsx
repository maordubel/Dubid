/**
 * components/Lobby.tsx — מסך הכניסה.
 *
 * ★ הברִיף: "צריך להרגיש כמו משחק תחרותי פרימיום, לא כמו לוח
 *   מחוונים של פנטזי."
 *
 * ההבדל הוא לא קישוטים. הוא **היררכיה**:
 *
 *   1. שעון      — כמה זמן נשאר. הדבר הדחוף היחיד במסך.
 *   2. שני מצבים — הפעולה. גדולים, שונים זה מזה, בלתי ניתנים להחמצה.
 *   3. כל השאר   — קטן, שקט, זמין למי שמחפש.
 *
 * לוח מחוונים נותן לכל דבר את אותו משקל. משחק אומר לך מה לעשות
 * עכשיו. לכן במסך הזה יש בדיוק שתי פעולות ראשיות — לא תשע.
 *
 * ★ המוטיב
 *
 * המשקפיים חוזרות בשלוש רמות: סימן מים ענק מאחורי הגיבור, מפריד
 * בין סקשנים, ותג קטן על כרטיס שכבר שוחק. אותה צורה בשלושה
 * גדלים היא מה שהופך לוגו לשפה.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Shades, ShadesDivider } from './Shades.tsx';
import { OffsidesBanner } from './OffsidesBanner.tsx';
import { DubelCredit } from './DubelCredit.tsx';
import type { Promo } from '../lib/growth.ts';
import {
  GameweekStatus, STATUS_LABEL_HE, countdown, daysLabel,
  isSubmissionOpen, msUntilDeadline, type Gameweek,
} from '../lib/gameweek.ts';
import type { ModeId } from '../lib/events/bus.ts';

export interface LobbyMode {
  id: ModeId;
  title: string;
  tagline: string;
  /** מצב ההרכב של המשתמש במצב הזה. */
  state: 'empty' | 'draft' | 'submitted' | 'scored';
  /** נקודות המחזור, אם כבר נוקד. */
  points?: number;
  /** מקום בדירוג, אם כבר נוקד. */
  rank?: number;
  filled: number;
  size: number;
}

export interface LobbyProps {
  gameweek: Gameweek;
  /** שעון מסונכרן־שרת. מוזרק כדי שהמסך לא ימציא זמן משלו. */
  nowMs: number;
  modes: LobbyMode[];
  displayName?: string;
  entrants?: number;
  leagueCount?: number;
  onPlay: (mode: ModeId) => void;
  onLeagues: () => void;
  onLeaderboard: () => void;
  /**
   * הפרסומת לאופסיידס. `null` = אין מה להציג עכשיו (נדחתה, או
   * שהתקרה נגמרה). מי שמחליט הוא `lib/growth.ts`, לא המסך הזה.
   */
  promo?: Promo | null;
  gameweekNumber?: number;
  onDismissPromo?: () => void;
  onOpenPromo?: (promo: Promo) => void;
}

export function Lobby({
  gameweek, nowMs, modes, displayName, entrants, leagueCount,
  onPlay, onLeagues, onLeaderboard,
  promo, gameweekNumber = gameweek.number, onDismissPromo, onOpenPromo,
}: LobbyProps) {
  // הספירה מתקתקת מקומית בין סנכרונים. `nowMs` הוא נקודת האמת,
  // וה-tick רק מזיז אותה קדימה כדי שהמסך לא ירגיש קפוא.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const now = nowMs + tick * 1000;
  const remaining = msUntilDeadline(gameweek, now);
  const open = isSubmissionOpen(gameweek, now);
  // פחות משעה = דחוף. הצבע משתנה, לא רק המספר.
  const urgent = open && remaining < 3600_000;
  const clock = countdown(remaining);

  return (
    <div className="flex min-h-full flex-col bg-night pb-6">
      {/* ═══════════ כותרת — שורה אחת, לא כרזה ═══════════ */}
      {/*
        ★ מה השתנה ולמה
        קודם הכותרת הייתה מגדל: באדג׳ 104px, כותרת 44px, שורת ברכה,
        ואז קופסת שעון בגובה 92px. יחד — כמעט 300 פיקסלים, כשליש
        ממסך טלפון, לפני שהמשתמש ראה **דבר אחד שאפשר ללחוץ עליו**.

        השעון הוא מידע, לא פעולה. הוא לא צריך את המספר הכי גדול
        במסך — הוא צריך להיות ברור. הפעולה היא שני הכפתורים, ולכן
        הם מקבלים את המקום שהתפנה.

        הכותרת עכשיו שורה אופקית אחת (~72px), והשעון פס אחד (~40px).
        התפנו כ-190 פיקסלים, וכולם הלכו לכפתורי המשחק.
      */}
      <header className="relative overflow-hidden px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <div
          // `left-1/2` ולא `start-1/2`: מירכוז גאומטרי. ב-RTL,
          // `start` עוגן מימין בעוד ה-transform מזיז שמאלה.
          className="pointer-events-none absolute left-1/2 top-0 h-24 w-56 -translate-x-1/2
                     rounded-full bg-toto/20 blur-3xl"
          aria-hidden="true"
        />

        <div className="relative mx-auto flex max-w-lg items-center gap-3 lg:max-w-3xl">
          <img
            src="/brand/dubid-badge.png"
            alt="דוביד"
            width={60}
            height={60}
            className="size-[60px] shrink-0 drop-shadow-[0_6px_18px_rgba(0,0,0,.5)]"
          />
          <div className="min-w-0 flex-1">
            <h1 className="font-poster text-[2rem] leading-none tracking-tight text-chalk">
              דוביד
            </h1>
            <p className="mt-0.5 truncate text-[12px] font-bold text-chalk-dim">
              {displayName ? `יאללה ${displayName}` : 'מי מבין יותר בכדורגל'}
            </p>
          </div>
          {entrants ? (
            <div className="shrink-0 text-end">
              <div dir="ltr" className="num text-lg leading-none text-chalk-2">{entrants}</div>
              <div className="text-[10px] text-chalk-dim">משתתפים</div>
            </div>
          ) : null}
        </div>
      </header>

      {/* ───── השעון — פס, לא קופסה ───── */}
      <div className="mx-auto w-full max-w-lg px-4 lg:max-w-3xl">
        <DeadlineStrip
          label={`${gameweek.label} · ${STATUS_LABEL_HE[gameweek.status]}`}
          open={open}
          urgent={urgent}
          clock={clock}
          closedText={
            gameweek.status === GameweekStatus.Published
              ? 'התוצאות פורסמו'
              : 'ההרכבים נעולים'
          }
        />
      </div>

      {/* ═══════════ שני המצבים — הפעולה, ורוב המסך ═══════════ */}
      {/*
        `flex-1` על הסקשן הזה הוא ההצהרה: כל מקום פנוי שנשאר
        במסך שייך לכפתורי המשחק, ולא לכרום שמעליהם.
      */}
      <section
        className="mx-auto mt-3 w-full max-w-lg flex-1 px-4 lg:max-w-3xl"
        aria-label="בחירת מצב משחק"
      >
        <h2 className="mb-2 text-[11px] font-black uppercase tracking-[0.2em] text-chalk-dim">
          במה משחקים
        </h2>
        {/* ★ תמיד זה לצד זה, גם במובייל — כך שההשוואה בין שני
            המצבים היא מיידית ולא דורשת גלילה. */}
        <div className="grid grid-cols-2 gap-3">
          {modes.map((m) => (
            <ModeCard key={m.id} mode={m} open={open} onPlay={() => onPlay(m.id)} />
          ))}
        </div>
      </section>

      <ShadesDivider className="mx-auto my-5 max-w-lg px-8 lg:max-w-3xl" />

      {/* ═══════════ משני ═══════════ */}
      <section className="mx-auto max-w-lg px-4 lg:max-w-3xl">
        <div className="grid grid-cols-2 gap-3">
          <TileButton
            label="ליגות פרטיות"
            hint={leagueCount ? `${leagueCount} ליגות` : 'שחקו מול חברים'}
            onClick={onLeagues}
            icon={<TileShades />}
          />
          <TileButton
            label="הדירוג"
            hint="מי מוביל"
            onClick={onLeaderboard}
            icon={<TilePodium />}
          />
        </div>
      </section>

      {/* ═══════════ אופסיידס — הפרסומת ═══════════ */}
      {promo && (
        <section className="mx-auto mt-6 w-full max-w-lg px-4 lg:max-w-3xl">
          <OffsidesBanner
            promo={promo}
            placement="lobby"
            gameweekNumber={gameweekNumber}
            onDismiss={onDismissPromo}
            onOpen={onOpenPromo}
          />
        </section>
      )}

      {/* ═══════════ קרדיט ═══════════ */}
      <footer className="mx-auto mt-6 w-full max-w-lg px-4 lg:max-w-3xl">
        <DubelCredit />
      </footer>
    </div>
  );
}

/* ================================================================== */
/* השעון                                                               */
/* ================================================================== */

/**
 * ★ פס, לא קופסה.
 *
 * הגרסה הקודמת נתנה לשעון קופסה בגובה 92 פיקסלים עם מספר בגודל
 * 36px — הדבר הכי גדול במסך. אבל שעון הוא **מידע**: הוא אומר
 * "כמה נשאר", לא "מה לעשות". המספר הכי גדול במסך צריך להיות
 * הפעולה, ובלובי הפעולה היא שני כפתורי המשחק.
 *
 * הפס נותן בדיוק את אותו מידע בשורה אחת: נקודת מצב, שם המחזור,
 * והזמן. הוא נקרא באותה מהירות ותופס פחות מחצי מהגובה.
 *
 * מה נשמר מהגרסה הקודמת, כי זה היה נכון:
 *   · המספר מבודד ב-`dir="ltr"` — אחרת "4 ימים 02:12" מתהפך.
 *   · מתחת לשעה הצבע מתחלף לאדום. דחיפות היא צבע, לא סימן קריאה.
 */
function DeadlineStrip({
  label, open, urgent, clock, closedText,
}: {
  label: string;
  open: boolean;
  urgent: boolean;
  clock: { days: number; clock: string };
  closedText: string;
}) {
  return (
    <div
      className={[
        'flex items-center gap-2.5 rounded-2xl border px-3.5 py-2.5 transition-colors',
        urgent
          ? 'border-flare/40 bg-flare/10'
          : open
            ? 'border-toto/25 bg-toto/[0.06]'
            : 'border-chalk/10 bg-night-2',
      ].join(' ')}
    >
      <span
        className={[
          'size-1.5 shrink-0 rounded-full',
          open ? (urgent ? 'animate-pulse bg-flare' : 'bg-toto') : 'bg-chalk-dim',
        ].join(' ')}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate text-[11px] font-black
                       uppercase tracking-[0.16em] text-chalk-dim">
        {label}
      </span>

      {open ? (
        <span className="flex shrink-0 items-baseline gap-1.5">
          {clock.days > 0 && (
            <span className="text-[11px] font-black text-chalk-2">
              {daysLabel(clock.days)}
            </span>
          )}
          {/* המספר לחוד, העברית לחוד. עירוב ביניהם הופך
              "4ד 02:12:38" ל-"402:12:38 ד" ברינדור. */}
          <span
            dir="ltr"
            className={`num text-lg font-black leading-none ${
              urgent ? 'text-flare' : 'text-toto'
            }`}
          >
            {clock.clock}
          </span>
        </span>
      ) : (
        <span className="shrink-0 text-[12px] font-black text-chalk">{closedText}</span>
      )}
    </div>
  );
}

/* ================================================================== */
/* כרטיס מצב משחק                                                      */
/* ================================================================== */

/**
 * ★ הכרטיס **הוא** התמונה שסופקה.
 *
 * הברִיף מפורש: "אם סופקה תמונת כפתור, השתמש בה ככפתור החזותי
 * במקום לשחזר כפתור CSS גנרי." לכן אין כאן גרדיאנטים, אין
 * טיפוגרפיה משוחזרת, ואין ניסיון לחקות את העיצוב — התמונה
 * מרונדרת כמו שהיא, והיא כולה שטח לחיץ.
 *
 * ★ מה כן מצויר מעליה
 *
 * התמונה סטטית; מצב המשחק לא. שתי שכבות דקות בלבד, ושתיהן
 * ממוקמות במכוון בשוליים כדי לא לכסות את האיור או הטקסט:
 *
 *   · תג מצב בפינה העליונה־שמאלית — מול מספר המצב שבתמונה
 *   · פס התקדמות/תוצאה לאורך הקצה התחתון
 *
 * ה-CTA שמוטבע בתמונה נשאר. הוא נכון ברוב המצבים, ותג המצב
 * מוסיף את מה שהוא לא יכול לדעת.
 */
function ModeCard({
  mode, open, onPlay,
}: { mode: LobbyMode; open: boolean; onPlay: () => void }) {
  const five = mode.id === 'five';
  const done = mode.state === 'submitted' || mode.state === 'scored';
  const progress = mode.size > 0 ? Math.min(1, mode.filled / mode.size) : 0;
  const accent = five ? '#3FA9F5' : '#3ED07A';

  return (
    <button
      onClick={onPlay}
      aria-label={`${mode.title} — ${mode.tagline}`}
      className="tap group relative block w-full overflow-hidden rounded-2xl
                 ring-1 ring-inset ring-chalk/10 transition-transform duration-200
                 ease-brand active:scale-[0.985]"
    >
      <img
        src={five ? '/brand/mode-five.jpg' : '/brand/mode-full.jpg'}
        alt=""
        width={760}
        height={442}
        loading="eager"
        decoding="async"
        className="block w-full"
      />

      {/* תג מצב — פינה עליונה־שמאלית, הצד הפנוי בשתי התמונות */}
      <span
        className="absolute top-2 rounded-full px-2.5 py-1 text-[10px] font-black
                   backdrop-blur-sm"
        style={{
          insetInlineEnd: 'auto',
          insetInlineStart: '0.5rem',
          background: done ? accent : 'rgba(0,0,0,.55)',
          color: done ? '#08141F' : '#F6F3EB',
        }}
      >
        {statusChip(mode, open)}
      </span>

      {/* פס תחתון — התקדמות בבנייה, או ניקוד כשיש */}
      <span className="absolute inset-x-0 bottom-0 h-1.5 bg-black/45" aria-hidden="true">
        <span
          className="block h-full transition-[width] duration-300 ease-brand"
          style={{ width: `${(done ? 1 : progress) * 100}%`, background: accent }}
        />
      </span>

      {/* תוצאה — רק כשיש. נצמד לקצה התחתון־שמאלי, מעל הפס. */}
      {done && mode.points !== undefined && (
        <span
          className="absolute bottom-3 flex items-baseline gap-1 rounded-lg bg-black/60
                     px-2 py-1 backdrop-blur-sm"
          style={{ insetInlineStart: '0.5rem' }}
        >
          <span dir="ltr" className="num text-lg font-black leading-none" style={{ color: accent }}>
            {mode.points}
          </span>
          {mode.rank !== undefined && (
            <span className="text-[10px] text-chalk/80">
              מקום <span dir="ltr" className="num">{mode.rank}</span>
            </span>
          )}
        </span>
      )}
    </button>
  );
}

/** תג המצב. קצר בכוונה — הוא יושב על איור, לא על רקע נקי. */
function statusChip(mode: LobbyMode, open: boolean): string {
  if (mode.state === 'scored') return 'התוצאה מוכנה';
  if (mode.state === 'submitted') return 'ההרכב נעול';
  if (!open) return 'נעול';
  if (mode.state === 'draft') return `${mode.filled}/${mode.size}`;
  return 'חדש';
}

/* ================================================================== */

function TileButton({
  label, hint, icon, onClick,
}: { label: string; hint: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="tap flex flex-col items-start gap-0.5 rounded-2xl border border-chalk/10
                 bg-night-2 px-4 py-3.5 text-start transition-colors duration-200
                 ease-brand hover:border-chalk/20 active:bg-night-3"
    >
      <span aria-hidden className="text-toto">{icon}</span>
      <span className="mt-1.5 text-sm font-black text-chalk">{label}</span>
      <span className="text-[11px] text-chalk-dim">{hint}</span>
    </button>
  );
}

/* אייקוני האריחים — מצוירים, לא תווי יוניקוד.
   גליף כמו ◆ נראה כמו שריד ולא כמו החלטה. */
function TileShades() {
  return <Shades size={26} glint={false} />;
}

function TilePodium() {
  return (
    <svg viewBox="0 0 28 20" width="26" height="19" aria-hidden="true">
      <rect x="10" y="2"  width="8" height="18" rx="1.5" fill="currentColor" />
      <rect x="1"  y="8"  width="8" height="12" rx="1.5" fill="currentColor" opacity=".6" />
      <rect x="19" y="12" width="8" height="8"  rx="1.5" fill="currentColor" opacity=".4" />
    </svg>
  );
}
