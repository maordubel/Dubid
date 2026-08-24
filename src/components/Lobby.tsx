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
  onOffsides?: () => void;
}

export function Lobby({
  gameweek, nowMs, modes, displayName, entrants, leagueCount,
  onPlay, onLeagues, onLeaderboard, onOffsides,
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
    <div className="min-h-full bg-night pb-10">
      {/* ═══════════ גיבור ═══════════ */}
      <header className="relative overflow-hidden px-4 pb-5 pt-[calc(1rem+env(safe-area-inset-top))]">
        {/* סימן מים — המשקפיים בענק, כמעט בלתי נראות */}
        {/* ★ אין כאן סימן מים של משקפיים, בכוונה.
            הבאדג׳ עצמו כבר מציג אותן. לחזור על אותה צורה מיד
            מאחוריה יצר כתם כהה שנקרא כאובייקט זר ולא כמרקם.
            המוטיב חוזר במפריד, בכרטיסים ובאריחים — שם הוא מוסיף. */}
        {/* זוהר צמוד לבאדג׳ בלבד. קודם הוא היה רחב ועז מדי
            וצבע את כל הכותרת בחום עכור. */}
        <div
          // `left-1/2` ולא `start-1/2`: מירכוז גאומטרי. ב-RTL,
          // `start` עוגן מימין בעוד ה-transform מזיז שמאלה, והזוהר
          // יצא מוסט. אותו באג בדיוק שהיה במיקום השחקנים על המגרש.
          className="pointer-events-none absolute left-1/2 top-6 h-32 w-32 -translate-x-1/2
                     rounded-full bg-toto/25 blur-2xl"
          aria-hidden="true"
        />

        <div className="relative mx-auto flex max-w-lg flex-col items-center lg:max-w-3xl">
          <img
            src="/brand/dubid-badge.png"
            alt="דוביד"
            width={104}
            height={104}
            className="h-[104px] w-[104px] drop-shadow-[0_10px_30px_rgba(0,0,0,.55)]"
          />

          <h1 className="mt-2.5 font-poster text-[2.75rem] leading-none tracking-tight text-chalk">
            דוביד
          </h1>
          <p className="mt-1 text-sm font-bold text-chalk-dim">
            {displayName ? `יאללה ${displayName}` : 'מי מבין יותר בכדורגל'}
          </p>

          {/* ───── השעון ───── */}
          <div
            className={[
              'mt-4 w-full rounded-3xl border px-5 py-3.5 text-center transition-colors',
              urgent
                ? 'border-flare/40 bg-flare/10'
                : open
                  ? 'border-toto/30 bg-toto/[0.07]'
                  : 'border-chalk/10 bg-night-2',
            ].join(' ')}
          >
            <div className="flex items-center justify-center gap-2">
              <span
                className={[
                  'inline-block size-1.5 rounded-full',
                  open ? (urgent ? 'animate-pulse bg-flare' : 'bg-toto') : 'bg-chalk-dim',
                ].join(' ')}
                aria-hidden="true"
              />
              <span className="text-[11px] font-black uppercase tracking-[0.22em] text-chalk-dim">
                {gameweek.label} · {STATUS_LABEL_HE[gameweek.status]}
              </span>
            </div>

            {open ? (
              <>
                {/* ★ המספר לחוד, העברית לחוד. עירוב ביניהם הופך
                    "4ד 02:12:38" ל-"402:12:38 ד" ברינדור. */}
                {clock.days > 0 && (
                  <div className="mt-1 text-sm font-black text-chalk">
                    {daysLabel(clock.days)}
                  </div>
                )}
                <div
                  dir="ltr"
                  className={`num mt-1 text-4xl font-black leading-none ${
                    urgent ? 'text-flare' : 'text-toto'
                  }`}
                >
                  {clock.clock}
                </div>
                <div className="mt-1 text-[11px] text-chalk-dim">
                  {urgent ? 'ההרכב ננעל עוד מעט' : 'עד נעילת ההרכבים'}
                </div>
              </>
            ) : (
              <div className="mt-1.5 font-display text-xl font-black text-chalk">
                {gameweek.status === GameweekStatus.Published
                  ? 'התוצאות פורסמו'
                  : 'ההרכבים נעולים'}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ═══════════ שני המצבים — הפעולה ═══════════ */}
      <section className="mx-auto max-w-lg px-4 lg:max-w-3xl" aria-label="בחירת מצב משחק">
        {/* ★ תמיד זה לצד זה, גם במובייל.
            הברִיף מפורש: "side-by-side, not vertically stacked".
            יחס 1.72 מאפשר את זה — שני כרטיסים ברוחב 46% נשארים
            קריאים גם ב-320 פיקסלים. */}
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
          {modes.map((m) => (
            <ModeCard key={m.id} mode={m} open={open} onPlay={() => onPlay(m.id)} />
          ))}
        </div>
      </section>

      <ShadesDivider className="mx-auto my-7 max-w-lg px-8 lg:max-w-3xl" />

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
            hint={entrants ? `${entrants} משתתפים` : 'מי מוביל'}
            onClick={onLeaderboard}
            icon={<TilePodium />}
          />
        </div>
      </section>

      {/* ═══════════ אופסיידס ═══════════ */}
      {onOffsides && (
        <section className="mx-auto mt-7 max-w-lg px-4 lg:max-w-3xl">
          <button
            onClick={onOffsides}
            className="tap group flex w-full items-center gap-3 overflow-hidden rounded-2xl
                       border border-chalk/10 bg-night-2 px-4 py-3 text-start
                       transition-colors duration-200 ease-brand hover:border-chalk/20"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ink text-paper">
              <Shades size={26} glint={false} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-black text-chalk">אופסיידס</span>
              <span className="block truncate text-[11px] text-chalk-dim">
                חיזוי משחקים חי · אותו חשבון
              </span>
            </span>
            <span aria-hidden className="text-chalk-dim transition-transform
                                          group-hover:-translate-x-0.5">←</span>
          </button>
        </section>
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
