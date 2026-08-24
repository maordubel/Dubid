/**
 * components/Lobby.tsx — מסך הכניסה.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ סבב הלוגו החדש
 * ═══════════════════════════════════════════════════════════════
 *
 * הרפרנס שסופק הוא מסך אחד עם ארבע קומות ברורות:
 *
 *      זהות     →  מי אני, בשורה דקה
 *      גיבור    →  הלוגו, גדול, על עץ כהה
 *      מדדים    →  ארבעה מספרים בפס אחד
 *      פעולה    →  כרטיסי המצבים, ואז המשחקים הקרובים
 *
 * ההיררכיה מהגרסה הקודמת נשמרה במלואה — השעון עדיין הדבר הדחוף,
 * וכרטיסי המשחק עדיין הפעולה. מה שהשתנה הוא **הנוכחות**: ללוגו
 * יש עכשיו מקום משלו במקום להידחס לשורת כותרת של 60px.
 *
 * ★ מה לא נלקח מהרפרנס, ובכוונה
 *
 *   · "LVL 23", פעמון התראות, "רצף 7" — אין לנו את הנתונים
 *     האלה. מדד שמראה מספר מומצא הוא גרוע ממדד שלא קיים.
 *   · ארבעה מצבי משחק. יש לנו שניים, והם השניים הנכונים.
 *
 * הפס העליון מציג את מה שאנחנו באמת יודעים: מי המשתמש, וכמה
 * אנשים במחזור.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Logo, LogoMark } from './Logo.tsx';
import { ShadesDivider } from './Shades.tsx';
import { OffsidesBanner } from './OffsidesBanner.tsx';
import { DubelCredit } from './DubelCredit.tsx';
import { TeamCrest } from './TeamCrest.tsx';
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

/** משחק קרוב, כפי שהלובי צריך אותו. בלי תלות במבנה של `data/fixtures`. */
export interface LobbyFixture {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  homeShort: string;
  awayShort: string;
  dayLabel: string;
  timeLabel: string;
}

export interface LobbyProps {
  gameweek: Gameweek;
  /** שעון מסונכרן־שרת. מוזרק כדי שהמסך לא ימציא זמן משלו. */
  nowMs: number;
  modes: LobbyMode[];
  displayName?: string;
  entrants?: number;
  leagueCount?: number;
  /** המקום שלי במחזור, כשכבר נוקד. */
  myRank?: number;
  /** הנקודות שלי במחזור, כשכבר נוקד. */
  myPoints?: number;
  fixtures?: LobbyFixture[];
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
  myRank, myPoints, fixtures = [],
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
    <div className="tex-wood flex min-h-full flex-col pb-6">
      {/* ═══════════ 1 · זהות — שורה דקה, לא כרזה ═══════════ */}
      <header className="mx-auto flex w-full max-w-lg items-center gap-2.5 px-4
                         pt-[calc(0.6rem+env(safe-area-inset-top))] lg:max-w-3xl">
        <span className="grid size-9 shrink-0 place-items-center rounded-full
                         bg-night-2 ring-1 ring-inset ring-gold/25">
          <LogoMark size={26} />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-chalk-dim">
            מאמן
          </div>
          <div className="truncate text-[15px] font-black text-chalk">
            {displayName || 'אורח'}
          </div>
        </div>
        {entrants ? (
          <span className="shrink-0 rounded-full bg-night-2 px-2.5 py-1
                           ring-1 ring-inset ring-gold/20">
            <span dir="ltr" className="num text-[13px] leading-none text-gold">{entrants}</span>
            <span className="ms-1 text-[10px] text-chalk-dim">משתתפים</span>
          </span>
        ) : null}
      </header>

      {/* ═══════════ 2 · הגיבור — הלוגו ═══════════ */}
      {/*
        ★ למה הלוגו גדול כאן ולא בשום מקום אחר.
        זה המסך היחיד שבו למשתמש אין משימה פתוחה. בכל שאר המסכים
        יש הרכב לבנות או טבלה לקרוא, ושם הלוגו יורד לסמל של 26px
        בכותרת. גודל הוא החלטה לפי מסך, לא קבוע של מותג.
      */}
      <div className="relative mx-auto mt-1 flex w-full max-w-lg justify-center px-4 lg:max-w-3xl">
        <div
          className="pointer-events-none absolute left-1/2 top-2 h-32 w-64 -translate-x-1/2
                     rounded-full bg-gold/15 blur-3xl"
          aria-hidden="true"
        />
        <Logo size={168} variant="gold" glow alt="דוביד" className="relative" />
      </div>

      {/* ───── השעון — פס, לא קופסה ───── */}
      <div className="mx-auto -mt-1 w-full max-w-lg px-4 lg:max-w-3xl">
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

      {/* ═══════════ 3 · המדדים ═══════════ */}
      <div className="mx-auto mt-2.5 w-full max-w-lg px-4 lg:max-w-3xl">
        <StatStrip
          items={[
            { label: 'המחזור', value: String(gameweekNumber) },
            { label: 'הנקודות שלי', value: myPoints !== undefined ? String(myPoints) : '—' },
            { label: 'המקום שלי', value: myRank ? `#${myRank}` : '—' },
            { label: 'ליגות', value: leagueCount ? String(leagueCount) : '—' },
          ]}
        />
      </div>

      {/* ═══════════ 4 · הפעולה ═══════════ */}
      <section className="mx-auto mt-4 w-full max-w-lg px-4 lg:max-w-3xl" aria-label="בחירת מצב משחק">
        <SectionTitle>במה משחקים</SectionTitle>
        {/* ★ שורות ולא רשת.
            הרפרנס משתמש בשורות ברוחב מלא, ובצדק: לכל מצב יש
            כותרת, משפט הסבר ומצב נוכחי. בחצי רוחב מסך הכותרת
            נשברת לשתי שורות והמשפט נחתך — ואז שני הכרטיסים
            נראים זהים, וזה בדיוק מה שהם לא. */}
        <div className="mt-2 space-y-2.5">
          {modes.map((m) => (
            <ModeRow key={m.id} mode={m} open={open} onPlay={() => onPlay(m.id)} />
          ))}
        </div>
      </section>

      {/* ═══════════ המשחקים הקרובים ═══════════ */}
      {fixtures.length > 0 && (
        <section className="mx-auto mt-5 w-full max-w-lg px-4 lg:max-w-3xl">
          <SectionTitle>המשחקים הקרובים</SectionTitle>
          <ul className="mt-2 overflow-hidden rounded-2xl bg-night-2/70 edge-gold">
            {fixtures.slice(0, 4).map((f) => (
              <li key={f.id}
                  className="flex items-center gap-2 border-b border-gold/10 px-3 py-2.5 last:border-0">
                <span className="w-[52px] shrink-0 text-[10px] leading-tight text-chalk-dim">
                  {f.dayLabel}
                  <br />
                  <span dir="ltr" className="num text-[11px] text-chalk-2">{f.timeLabel}</span>
                </span>
                <TeamCrest teamId={f.homeTeamId} short={f.homeShort} size={22} />
                <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-chalk">
                  {f.homeShort} <span className="text-chalk-dim">מול</span> {f.awayShort}
                </span>
                <TeamCrest teamId={f.awayTeamId} short={f.awayShort} size={22} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <ShadesDivider className="mx-auto my-5 max-w-lg px-8 lg:max-w-3xl" />

      {/* ═══════════ משני ═══════════ */}
      <section className="mx-auto w-full max-w-lg px-4 lg:max-w-3xl">
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

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-[10px] font-black uppercase
                   tracking-[0.22em] text-chalk-dim">
      <span aria-hidden className="h-px w-3 bg-gold/40" />
      {children}
    </h2>
  );
}

/* ================================================================== */
/* פס המדדים                                                           */
/* ================================================================== */

/**
 * ★ למה '—' ולא אפס.
 *
 * "0 נקודות" ו"עוד אין תוצאות" הם שני דברים שונים לגמרי, ומשתמש
 * שרואה אפס אחרי שהגיש הרכב חושב שמשהו נשבר. מקף אומר "אין נתון
 * עדיין", ואפס אומר "נוקד, ולא הבאת".
 */
function StatStrip({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <div className="grid grid-cols-4 overflow-hidden rounded-2xl bg-night-2/70 edge-gold">
      {items.map((s, i) => (
        <div
          key={s.label}
          className={`px-1.5 py-2.5 text-center ${i > 0 ? 'border-s border-gold/12' : ''}`}
        >
          <div dir="ltr" className="num text-[17px] leading-none text-gold-light">{s.value}</div>
          <div className="mt-1 truncate text-[9.5px] font-bold text-chalk-dim">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

/* ================================================================== */
/* השעון                                                               */
/* ================================================================== */

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
            ? 'border-gold/25 bg-gold/[0.06]'
            : 'border-gold/15 bg-night-2',
      ].join(' ')}
    >
      <span
        className={[
          'size-1.5 shrink-0 rounded-full',
          open ? (urgent ? 'animate-pulse bg-flare' : 'bg-gold') : 'bg-chalk-dim',
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
              urgent ? 'text-flare' : 'text-gold-light'
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
/* שורת מצב משחק                                                       */
/* ================================================================== */

/**
 * ★ התמונה נשארה — היא ירדה מלהיות הכרטיס להיות הרקע שלו.
 *
 * בגרסה הקודמת האיור *היה* הכפתור, כולל ה-CTA המוטבע בו. זה עבד
 * כשהאיור היה כל מה שהיה לנו. עכשיו יש שפה: זהב על עץ, טיפוגרפיה
 * אחת, ומסגרת אחת. איור עם טקסט צרוב בפנים לא יכול להשתתף בה —
 * הוא לא מתיישר, לא מתרגם, ולא משנה מצב.
 *
 * לכן: האיור מתוח לרוחב השורה ומועם, והשכבה שמעליו היא הממשק.
 * המידע — כותרת, משפט, מצב, התקדמות — הוא טקסט אמיתי.
 */
function ModeRow({
  mode, open, onPlay,
}: { mode: LobbyMode; open: boolean; onPlay: () => void }) {
  const five = mode.id === 'five';
  const done = mode.state === 'submitted' || mode.state === 'scored';
  const progress = mode.size > 0 ? Math.min(1, mode.filled / mode.size) : 0;

  return (
    <button
      onClick={onPlay}
      aria-label={`${mode.title} — ${mode.tagline}`}
      className="tap group relative block w-full overflow-hidden rounded-2xl bg-night-2
                 text-start edge-gold transition-transform duration-200 ease-brand
                 active:scale-[0.99]"
    >
      {/* הרקע: האיור, מועם ומכוסה בגרדיאנט שמחזיק את הטקסט קריא */}
      <img
        src={five ? '/brand/mode-five.jpg' : '/brand/mode-full.jpg'}
        alt=""
        aria-hidden="true"
        loading="eager"
        decoding="async"
        className="absolute inset-0 size-full object-cover opacity-[0.30]"
      />
      <span
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-l from-night/95 via-night/80 to-night/45"
      />

      <span className="relative flex items-center gap-3 px-3.5 py-3.5">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl
                         bg-gold/10 text-gold ring-1 ring-inset ring-gold/30">
          {five ? <IconFive /> : <IconEleven />}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-poster text-[19px] leading-none text-chalk">
              {mode.title}
            </span>
            <span
              className={[
                'shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-black leading-[14px]',
                done
                  ? 'bg-gold text-gold-ink'
                  : open
                    ? 'bg-gold/15 text-gold-light ring-1 ring-inset ring-gold/30'
                    : 'bg-night-3 text-chalk-dim',
              ].join(' ')}
            >
              {statusChip(mode, open)}
            </span>
          </span>
          <span className="mt-1 block truncate text-[12px] text-chalk-2">{mode.tagline}</span>
        </span>

        {mode.points !== undefined ? (
          <span className="shrink-0 text-center">
            <span dir="ltr" className="num block text-xl leading-none text-gold-light">
              {mode.points}
            </span>
            <span className="text-[9px] text-chalk-dim">נקודות</span>
          </span>
        ) : (
          <Chevron />
        )}
      </span>

      {/* פס תחתון — התקדמות בבנייה, מלא כשהוגש */}
      <span className="absolute inset-x-0 bottom-0 h-[3px] bg-black/50" aria-hidden="true">
        <span
          className="block h-full bg-gradient-to-l from-gold-deep to-gold-light
                     transition-[width] duration-300 ease-brand"
          style={{ width: `${(done ? 1 : progress) * 100}%` }}
        />
      </span>
    </button>
  );
}

/** תג המצב. קצר בכוונה — הוא יושב ליד כותרת, לא לבד. */
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
      className="tap flex flex-col items-start gap-0.5 rounded-2xl bg-night-2 px-4 py-3.5
                 text-start edge-gold transition-colors duration-200 ease-brand
                 active:bg-night-3"
    >
      <span aria-hidden className="text-gold">{icon}</span>
      <span className="mt-1.5 text-sm font-black text-chalk">{label}</span>
      <span className="text-[11px] text-chalk-dim">{hint}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* אייקונים — מצוירים, לא תווי יוניקוד.
   גליף כמו ◆ נראה כמו שריד ולא כמו החלטה.                             */
/* ------------------------------------------------------------------ */

/** לוח טקטיקה עם חמישה סימנים — ההד של הלוח שדוביד מחזיק בלוגו. */
function IconFive() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
      <rect x="2.5" y="4.5" width="19" height="15" rx="2"
            stroke="currentColor" strokeWidth="1.3" />
      <path d="M12 4.5v15" stroke="currentColor" strokeWidth="1" opacity=".5" />
      <circle cx="7" cy="9" r="1.3" fill="currentColor" />
      <circle cx="7" cy="15" r="1.3" fill="currentColor" />
      <circle cx="17" cy="9" r="1.3" fill="currentColor" />
      <circle cx="17" cy="15" r="1.3" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}

/** מגרש מלא עם שלוש שורות — 11 נקודות בדיוק. */
function IconEleven() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
      <rect x="2.5" y="3.5" width="19" height="17" rx="2"
            stroke="currentColor" strokeWidth="1.3" />
      <path d="M2.5 12h19" stroke="currentColor" strokeWidth="1" opacity=".45" />
      <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1" opacity=".45" />
      {[6, 12, 18].map((x) => <circle key={`a${x}`} cx={x} cy="6.5" r="1.05" fill="currentColor" />)}
      {[5, 9.5, 14.5, 19].map((x) => <circle key={`b${x}`} cx={x} cy="12" r="1.05" fill="currentColor" />)}
      {[6, 12, 18].map((x) => <circle key={`c${x}`} cx={x} cy="17.5" r="1.05" fill="currentColor" />)}
    </svg>
  );
}

function Chevron() {
  return (
    // ב-RTL החץ מצביע שמאלה. `scale-x-[-1]` היה מסובב אותו לכיוון
    // הלא־נכון בדסקטופ LTR — לכן הצורה עצמה כתובה לכיוון הנכון.
    <svg viewBox="0 0 12 20" width="11" height="18" aria-hidden="true"
         className="shrink-0 text-gold/60">
      <path d="M9 2 3 10l6 8" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TileShades() {
  return (
    <svg viewBox="0 0 28 12" width="26" height="12" aria-hidden="true">
      <path d="M1 2.5h10.2c.6 0 1 .5.9 1.1l-.5 4c-.2 1.4-1.4 2.4-2.8 2.4H6.4c-1.5 0-2.7-1.1-2.9-2.6L3 4"
            fill="currentColor" opacity=".9" />
      <path d="M27 2.5H16.8c-.6 0-1 .5-.9 1.1l.5 4c.2 1.4 1.4 2.4 2.8 2.4h2.4c1.5 0 2.7-1.1 2.9-2.6l.5-3.4"
            fill="currentColor" opacity=".9" />
      <path d="M12 4.2c1.3-.5 2.7-.5 4 0" fill="none" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
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
