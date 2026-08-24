/**
 * SquadPicker.tsx — בחירת סגל עם מפת כיסוי קבוצות.
 *
 * הרעיון המרכזי: המשתמש לא אמור *לגלות* את החוק דרך הודעת שגיאה.
 * הוא אמור לראות אותו כל הזמן. לכן מעל המגרש יש רצועת "כיסוי קבוצות"
 * שמראה בכל רגע אילו מ-14 הקבוצות כבר מיוצגות ואילו עוד פנויות,
 * ובגיליון הבחירה שחקנים מקבוצה תפוסה מוצגים נעולים ולא נעלמים —
 * ככה המשתמש מבין למה, ורואה את מי הוא צריך להחליף.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  teamCoverage, validateLineup, formatIssue, teamBlock,
} from '../lib/scoring/validate.ts';
import { Jersey, jerseyMonogram } from './Jersey.tsx';
import { teamColor } from '../data/teamColors.ts';
import { TeamCrest } from './TeamCrest.tsx';
import { Pitch } from './Pitch.tsx';
import { FormationPicker } from './FormationPicker.tsx';
import { formationsFor } from '../lib/formation.ts';
import type { RuleSet } from '../lib/scoring/rules.ts';
import type { Lineup, LineupSlot, Position } from '../lib/scoring/types.ts';

export interface PoolPlayer {
  id: string;
  teamId: string;
  position: Position;
  name: string;         // כבר מותאם לשפת המשתמש בשרת
  nameShort: string;
  form?: number;
  price?: number;
}

export interface TeamMeta {
  id: string;
  short: string;        // 'מ״ח'
  name: string;         // 'מכבי חיפה'
  color?: string;
}

const POSITION_LABEL: Record<Position, string> = {
  GK: 'שוער', DEF: 'הגנה', MID: 'קישור', FWD: 'התקפה',
};

export interface SquadPickerProps {
  lineup: Lineup;
  pool: PoolPlayer[];
  teams: TeamMeta[];
  rules: RuleSet;
  onAssign: (slotNo: number, player: PoolPlayer) => void;
  onClear: (slotNo: number) => void;
  onCaptain: (playerId: string) => void;
  onSubmit: () => void;
  /** קיצור היריבה במחזור הנוכחי, לפי מזהה קבוצה — "נגד מי משחקים" בגיליון הבחירה. */
  opponentShortByTeam?: Record<string, string>;
  /** מצב 5 על 5: מציג עמודת/תג מחיר ליד כל שחקן, בבורר ובמגרש. */
  pricing?: boolean;
  /**
   * תקציב במיליוני יורו. כשהוא מוגדר, הבורר הופך לאילוץ חי:
   * מחוון תקציב דביק, ושחקנים יקרים מדי מסומנים כלא זמינים.
   */
  budget?: number;
  /** בחירת סגן קפטן. בלי זה תג ה-V לא מוצג. */
  onVice?: (playerId: string) => void;
  /** החלפת מערך טקטי. בלי זה הבורר לא מוצג. */
  onFormation?: (formation: string) => void;
  /** שחקנים שנפלו בהחלפת המערך האחרונה — מוצגים כהודעה. */
  droppedNames?: string[];
}

export function SquadPicker(props: SquadPickerProps) {
  const {
    lineup, pool, teams, rules, onAssign, onClear, onCaptain, onSubmit,
    opponentShortByTeam, pricing, budget, onVice, onFormation, droppedNames,
  } = props;
  const [picking, setPicking] = useState<LineupSlot | null>(null);
  const [sheet, setSheet] = useState<'teams' | 'formation' | 'budget' | null>(null);

  /** הודעה חולפת אחת. עדיפה על ערימת התראות שדוחפת את המגרש. */
  const notice = droppedNames && droppedNames.length > 0
    ? `המערך השתנה — ירדו: ${droppedNames.join(', ')}`
    : null;

  // ★ מקור אמת אחד לעלות. חושב כאן ולא מתקבל כ-prop, כי אחרת
  //   המחוון והבדיקה "אפשר להרשות?" יכולים להיפרד — וזה בדיוק
  //   הבאג שבו המשתמש רואה "נשארו 3M" ומקבל שגיאת חריגה.
  const priceById = useMemo(() => new Map(pool.map((p) => [p.id, p.price ?? 0])), [pool]);
  const spent = useMemo(
    () => lineup.slots.reduce((sum, s) => sum + (s.playerId ? priceById.get(s.playerId) ?? 0 : 0), 0),
    [lineup.slots, priceById],
  );
  const remaining = budget !== undefined ? budget - spent : undefined;

  const filled = lineup.slots.filter((s) => s.playerId).length;
  const issues = useMemo(() => validateLineup(lineup, rules), [lineup, rules]);
  const ready = issues.length === 0;

  const coverage = useMemo(
    () => teamCoverage(lineup, teams.map((t) => t.id), rules),
    [lineup, teams, rules],
  );
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  /**
   * ★ המהפך במובייל.
   *
   * מה היה: כותרת, רצועת כיסוי, פס תקציב ובורר מערכים — כל אחד
   * שורה מלאה, בזה אחר זה. יחד הם בלעו את חצי המסך, המגרש נדחף
   * מתחת לקפל, והמשתמש ראה חצי מגרש שנגלל.
   *
   * מה עכשיו: **שורת בקרה אחת** של צ׳יפים. כל צ׳יפ מציג את המספר
   * שחשוב (3/14 · 4.0M · 2-1-1) ונפתח לגיליון בלחיצה. כל מה
   * שנחסך הולך למגרש.
   *
   * המגרש מקבל `fit="height"` — הוא ממלא בדיוק את מה שנשאר
   * ונראה במלואו. אין גלילה במסך הזה בכלל.
   */
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ControlBar
        coverage={coverage}
        teamById={teamById}
        budget={budget}
        spent={spent}
        filled={filled}
        size={rules.constraints.lineupSize}
        formation={lineup.formation}
        onOpen={setSheet}
      />

      {/* ---- המגרש — כל מה שנשאר, ובלי גלילה ---- */}
      <div className="grid min-h-0 flex-1 place-items-center px-2 py-2">
        <Pitch
          formation={lineup.formation}
          fit="height"
          className="ring-1 ring-inset ring-chalk/15"
          renderSlot={(slotNo) => {
            const slot = lineup.slots.find((x) => x.slotNo === slotNo);
            if (!slot) return null;
            return (
              <SlotCard
                slot={slot}
                player={pool.find((p) => p.id === slot.playerId)}
                team={teamById.get(slot.teamId)}
                pricing={pricing}
                onPick={() => setPicking(slot)}
                onClear={() => onClear(slot.slotNo)}
                onCaptain={() => slot.playerId && onCaptain(slot.playerId)}
                onVice={onVice && slot.playerId ? () => onVice(slot.playerId) : undefined}
              />
            );
          }}
        />
      </div>

      {/* ---- CTA + הודעות ---- */}
      {/*
        ★ ההודעה עוגנת ל-CTA, לא למסך.
        קודם היא הייתה `absolute bottom-[7.5rem]` בלי אב ממוקם — כלומר
        מרחק קסם מתחתית ה-viewport, שנשבר בכל שינוי גובה של הניווט או
        של סרגל הכתובות. עכשיו `bottom-full` על אב `relative`: תמיד
        בדיוק מעל הכפתור, בלי מספרים.
      */}
      <div className="relative shrink-0 border-t border-chalk/10 bg-night/95 px-4 pb-3 pt-2.5 backdrop-blur">
        {(notice || (!ready && filled === rules.constraints.lineupSize)) && (
          <div className="pointer-events-none absolute inset-x-0 bottom-full z-10 px-4 pb-2">
            <p
              role={notice ? 'status' : 'alert'}
              className={`mx-auto max-w-sm rounded-xl px-3 py-2 text-center text-xs
                          shadow-lg backdrop-blur ${
                            notice ? 'bg-armband/90 text-night' : 'bg-flare/90 text-white'
                          }`}
            >
              {notice ?? formatIssue(issues[0], 'he')}
            </p>
          </div>
        )}
        <button
          onClick={onSubmit}
          disabled={!ready}
          className="tap h-12 w-full rounded-2xl bg-toto font-poster text-lg text-night
                     transition-transform duration-200 ease-brand active:scale-[.98]
                     disabled:bg-night-3 disabled:text-chalk-dim"
        >
          {ready ? 'נעילת ההרכב' : `נותרו ${rules.constraints.lineupSize - filled} שחקנים`}
        </button>
      </div>

      {/* ---- גיליונות הבקרה ---- */}
      {sheet === 'teams' && (
        <ControlSheet title="כיסוי קבוצות" onClose={() => setSheet(null)}>
          <TeamCoverageGrid coverage={coverage} teamById={teamById} />
        </ControlSheet>
      )}
      {sheet === 'formation' && onFormation && (
        <ControlSheet title="מערך טקטי" onClose={() => setSheet(null)}>
          <FormationPicker
            options={formationsFor(rules.constraints.lineupSize)}
            value={lineup.formation}
            onChange={(f) => { onFormation(f); setSheet(null); }}
          />
        </ControlSheet>
      )}
      {sheet === 'budget' && budget !== undefined && (
        <ControlSheet title="תקציב" onClose={() => setSheet(null)}>
          <BudgetDetail budget={budget} spent={spent} filled={filled}
                        size={rules.constraints.lineupSize} />
        </ControlSheet>
      )}

      {picking && (
        <PlayerSheet
          slot={picking}
          pool={pool}
          teamById={teamById}
          lineup={lineup}
          rules={rules}
          onClose={() => setPicking(null)}
          onSelect={(p) => { onAssign(picking.slotNo, p); setPicking(null); }}
          opponentShortByTeam={opponentShortByTeam}
          pricing={pricing}
          remaining={remaining}
          teams={teams}
        />
      )}
    </div>
  );
}

/* ================================================================== */
/* שורת הבקרה                                                          */
/* ================================================================== */

/**
 * ★ שורה אחת, שלושה מספרים, אפס בזבוז.
 *
 * כל צ׳יפ עונה על שאלה אחת שהמשתמש שואל תוך כדי בנייה:
 *   "כמה קבוצות תפסתי?" · "כמה כסף נשאר?" · "באיזה מערך אני?"
 *
 * התשובה גלויה תמיד; הפירוט נפתח בלחיצה. זה מה שמשחרר את
 * המסך למגרש במקום שלוש רצועות שאף אחת מהן לא נקראת עד הסוף.
 */
function ControlBar({
  coverage, teamById, budget, spent, filled, size, formation, onOpen,
}: {
  coverage: ReturnType<typeof teamCoverage>;
  teamById: Map<string, TeamMeta>;
  budget?: number;
  spent: number;
  filled: number;
  size: number;
  formation: string;
  onOpen: (sheet: 'teams' | 'formation' | 'budget') => void;
}) {
  const used = coverage.filter((c) => c.filled).length;
  const remaining = budget !== undefined ? budget - spent : undefined;
  const over = remaining !== undefined && remaining < 0;

  return (
    <div className="shrink-0 border-b border-chalk/10 bg-night px-2.5 py-2">
      <div className="mx-auto flex max-w-3xl items-stretch gap-2">
        <Chip label="קבוצות" onClick={() => onOpen('teams')}>
          <span className="num" dir="ltr">{used}/{coverage.length}</span>
        </Chip>

        {remaining !== undefined && (
          <Chip label={over ? 'חריגה' : 'תקציב'} onClick={() => onOpen('budget')} alert={over}>
            <span className="num" dir="ltr">{remaining.toFixed(1)}M</span>
          </Chip>
        )}

        <Chip label="מערך" onClick={() => onOpen('formation')}>
          <span className="num" dir="ltr">{formation}</span>
        </Chip>

        <div className="grid shrink-0 place-items-center rounded-xl bg-night-2 px-3">
          <span className="num text-sm font-black text-toto" dir="ltr">{filled}/{size}</span>
        </div>
      </div>
    </div>
  );
}

function Chip({
  label, children, onClick, alert = false,
}: { label: string; children: ReactNode; onClick: () => void; alert?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={[
        'tap flex flex-1 flex-col items-center justify-center rounded-xl px-2 py-1.5',
        'transition-colors duration-200 ease-brand',
        alert ? 'bg-flare/15 text-flare' : 'bg-night-2 text-chalk active:bg-night-3',
      ].join(' ')}
    >
      <span className="text-[9px] font-bold tracking-wide text-chalk-dim">{label}</span>
      <span className="text-sm font-black leading-tight">{children}</span>
    </button>
  );
}

/* ================================================================== */
/* גיליון בקרה                                                         */
/* ================================================================== */

/** גיליון תחתון קצר. נסגר בלחיצה מחוץ אליו או ב-Escape. */
function ControlSheet({
  title, onClose, children,
}: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-sheet flex items-end bg-night/70 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[70dvh] w-full overflow-y-auto rounded-t-3xl bg-night-2 pb-[env(safe-area-inset-bottom)]
                   motion-safe:animate-slideUp lg:mx-auto lg:mb-8 lg:max-w-lg lg:rounded-3xl"
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-chalk/25" />
        <h2 className="px-4 pb-1 pt-3 font-display text-base font-black">{title}</h2>
        <div className="pb-4">{children}</div>
      </div>
    </div>
  );
}

/** רשת כיסוי הקבוצות — בגיליון, לא ברצועה שגוזלת גובה. */
function TeamCoverageGrid({
  coverage, teamById,
}: {
  coverage: ReturnType<typeof teamCoverage>;
  teamById: Map<string, TeamMeta>;
}) {
  return (
    <ul className="grid grid-cols-4 gap-2 px-4 sm:grid-cols-7">
      {coverage.map((c) => {
        const meta = teamById.get(c.teamId);
        return (
          <li
            key={c.teamId}
            title={meta?.name}
            className={[
              'flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-center',
              c.filled ? 'bg-toto/15 ring-1 ring-inset ring-toto/40' : 'bg-night-3 opacity-60',
            ].join(' ')}
          >
            <TeamCrest teamId={c.teamId} short={meta?.short} size={26} />
            <span className={`text-[10px] font-bold ${c.filled ? 'text-toto' : 'text-chalk-dim'}`}>
              {meta?.short ?? c.teamId}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** פירוט התקציב. הצ׳יפ מראה את המספר; כאן ההסבר. */
function BudgetDetail({
  budget, spent, filled, size,
}: { budget: number; spent: number; filled: number; size: number }) {
  const remaining = budget - spent;
  const over = remaining < 0;
  const left = size - filled;
  const perPlayer = left > 0 ? remaining / left : null;

  return (
    <div className="px-4">
      <div className="mb-2 h-2 overflow-hidden rounded-full bg-night-3">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ease-brand ${
            over ? 'bg-flare' : 'bg-toto'
          }`}
          style={{ width: `${Math.max(0, Math.min(100, (spent / budget) * 100))}%` }}
        />
      </div>
      <dl className="space-y-1.5 text-sm">
        <Row label="תקציב" value={`${budget}M€`} />
        <Row label="נוצל" value={`${spent.toFixed(1)}M€`} />
        <Row label={over ? 'חריגה' : 'נותר'} value={`${remaining.toFixed(1)}M€`} accent={over} />
        {perPlayer !== null && !over && (
          <Row
            label={`עד כמה לכל אחד מ-${left} הנותרים`}
            value={`${perPlayer.toFixed(1)}M€`}
          />
        )}
      </dl>
    </div>
  );
}

function Row({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-chalk-dim">{label}</dt>
      <dd className={`num font-black ${accent ? 'text-flare' : 'text-chalk'}`} dir="ltr">{value}</dd>
    </div>
  );
}

/* ================================================================== */
/* משבצת שחקן                                                          */
/* ================================================================== */

/**
 * כרטיס שחקן על המגרש.
 *
 * ★ הכרטיס לא קובע את רוחבו — המגרש קובע.
 *
 * `w-full` בתוך משבצת שרוחבה `clamp(...)` הוא מה שמונע את הבאג
 * המקורי. קודם היה כאן חולצה בגודל קבוע 56 פיקסלים ולוחית שם
 * ברוחב 92, וברגע שהשורה הכילה יותר משלושה שחקנים הם נדחסו
 * זה על זה. עכשיו הכל יחסי, וגודל הסמל נגזר באחוזים.
 *
 * ★ סמל המועדון ולא חולצה
 *
 * הברִיף ביקש סמלים אמיתיים, מאותו מקור כמו אופסיידס.
 * `TeamCrest` נופל לחולצה רק לשתי הקבוצות שאין להן סמל.
 */
function SlotCard({
  slot, player, team, pricing, onPick, onClear, onCaptain, onVice,
}: {
  slot: LineupSlot;
  player?: PoolPlayer;
  team?: TeamMeta;
  pricing?: boolean;
  onPick: () => void;
  onClear: () => void;
  onCaptain: () => void;
  onVice?: () => void;
}) {
  if (!player) {
    return (
      <button
        onClick={onPick}
        aria-label={`הוסף ${POSITION_LABEL[slot.position]}`}
        className="tap flex w-full flex-col items-center gap-1 text-chalk/60
                   transition-colors duration-200 ease-brand active:text-toto"
      >
        <span className="relative grid w-[62%] max-w-[40px] place-items-center">
          <Jersey ghost position={slot.position} size="fluid" />
          <span className="absolute text-lg font-black leading-none">+</span>
        </span>
        <span className="w-full truncate rounded-md border border-dashed border-chalk/30
                         bg-night/40 px-1 py-0.5 text-center text-[9px] font-bold">
          {POSITION_LABEL[slot.position]}
        </span>
      </button>
    );
  }

  const cap = !!slot.isCaptain;
  const vice = !!slot.isVice;
  const price = pricing && player.price !== undefined ? player.price : undefined;

  return (
    <div className="group relative flex w-full flex-col items-center gap-1">
      {/* הסמל — גם הוא הכפתור לפתיחת הבחירה מחדש */}
      <button
        onClick={onPick}
        aria-label={`החלף את ${player.nameShort}`}
        className="relative grid w-[62%] max-w-[42px] place-items-center"
      >
        <span className="w-full drop-shadow-[0_2px_5px_rgba(0,0,0,.6)]">
          <TeamCrest teamId={slot.teamId} short={team?.short} size="fluid" />
        </span>

        {cap && (
          <span className="absolute -top-1 -end-1.5 rounded bg-armband px-1 text-[8px]
                           font-black leading-[1.5] text-night shadow">
            C
          </span>
        )}
        {vice && !cap && (
          <span className="absolute -top-1 -end-1.5 rounded bg-tekhelet px-1 text-[8px]
                           font-black leading-[1.5] text-white shadow">
            V
          </span>
        )}
      </button>

      {/* לוחית שם */}
      <bdi className="w-full truncate rounded-md bg-chalk px-1 py-px text-center text-[9.5px]
                      font-black leading-[1.4] text-night shadow-sm">
        {player.nameShort}
      </bdi>

      {/* מחיר ב-5 על 5, אחרת קיצור הקבוצה */}
      <span className={[
        'w-full truncate rounded px-1 text-center text-[8.5px] font-black leading-[1.5]',
        price !== undefined ? 'bg-night/75 text-toto' : 'bg-night/65 text-chalk-dim',
      ].join(' ')}>
        {price !== undefined ? <span className="num" dir="ltr">{price}</span> : team?.short}
      </span>

      {/* ★ פעולות מופיעות בלחיצה/ריחוף ולא תמיד.
          שלושה כפתורים קבועים על כרטיס ברוחב 44 פיקסלים היו
          מכסים את השחקן עצמו — בדיוק התלונה על כפתורים שעולים
          זה על זה. */}
      <div className="absolute -top-1.5 start-0 flex gap-0.5 opacity-0 transition-opacity
                      duration-150 focus-within:opacity-100 group-hover:opacity-100
                      group-active:opacity-100">
        <button
          onClick={onClear}
          aria-label="הסר שחקן"
          className="grid size-5 place-items-center rounded-full bg-flare text-[10px]
                     font-black text-white shadow-md"
        >
          ✕
        </button>
        <button
          onClick={onCaptain}
          aria-pressed={cap}
          aria-label={cap ? 'הסר קפטן' : 'הפוך לקפטן'}
          className={`grid size-5 place-items-center rounded-full text-[9px] font-black shadow-md ${
            cap ? 'bg-armband text-night' : 'bg-night/90 text-chalk'
          }`}
        >
          C
        </button>
        {onVice && !cap && (
          <button
            onClick={onVice}
            aria-pressed={vice}
            aria-label={vice ? 'הסר סגן' : 'הפוך לסגן'}
            className={`grid size-5 place-items-center rounded-full text-[9px] font-black shadow-md ${
              vice ? 'bg-tekhelet text-white' : 'bg-night/90 text-chalk'
            }`}
          >
            V
          </button>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/* גיליון בחירת שחקן                                                   */
/* ================================================================== */

function PlayerSheet({
  slot, pool, teamById, teams, lineup, rules, onClose, onSelect,
  opponentShortByTeam, pricing, remaining,
}: {
  slot: LineupSlot;
  pool: PoolPlayer[];
  teamById: Map<string, TeamMeta>;
  teams: TeamMeta[];
  lineup: Lineup;
  rules: RuleSet;
  onClose: () => void;
  onSelect: (p: PoolPlayer) => void;
  opponentShortByTeam?: Record<string, string>;
  pricing?: boolean;
  /** תקציב פנוי. undefined = אין אילוץ תקציב במצב הזה. */
  remaining?: number;
}) {
  const [query, setQuery] = useState('');
  /**
   * ★ שתי דרכים למצוא שחקן, ושתיהן לגיטימיות:
   *   'players' — הרשימה השטוחה, ממוינת לפי שווי. מהיר למי שיודע.
   *   'teams'   — קודם בוחרים קבוצה, אחר כך שחקן. טבעי למי שחושב
   *               "מי מנצח השבוע" ורק אז "מי משם".
   * הברִיף מבקש את השנייה ל-11 ומדגיש: לשמור את הראשונה כחלופה.
   */
  const [browse, setBrowse] = useState<'players' | 'teams'>('players');
  const [openTeam, setOpenTeam] = useState<string | null>(null);

  const nameOf = useMemo(
    () => new Map(pool.map((p) => [p.id, p.nameShort])),
    [pool],
  );

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pool
      .filter((p) => p.position === slot.position)
      .filter((p) => (browse === 'teams' && openTeam ? p.teamId === openTeam : true))
      .filter((p) => {
        if (!q) return true;
        const team = teamById.get(p.teamId);
        return p.name.toLowerCase().includes(q) || (team?.name ?? '').toLowerCase().includes(q);
      })
      // ★ החסימה מגיעה מ-teamBlock, שמחזיר גם *מי* תופס את הקבוצה —
      //   כדי שנוכל לומר "כבר בחרת את אצילי" ולא רק להאפיר בלי הסבר.
      .map((p) => {
        const block = teamBlock(lineup, p.teamId, rules);
        // ★ "יקר מדי" הוא חסימה נפרדת מ"קבוצה תפוסה", ומוצגת אחרת.
        //   מיזוג השתיים היה מסתיר מהמשתמש מה בדיוק הבעיה.
        const tooExpensive =
          remaining !== undefined && p.price !== undefined && p.price > remaining;
        return { p, block, tooExpensive };
      })
      // חסומים יורדים לסוף אבל לא נעלמים: משתמש צריך להבין למה, לא לחפש
      .sort((a, b) => {
        const aOut = Number(a.block.blocked || a.tooExpensive);
        const bOut = Number(b.block.blocked || b.tooExpensive);
        if (aOut !== bOut) return aOut - bOut;
        // ★ הברִיף: מיון לפי שווי, מהגבוה לנמוך. לא לפי קבוצה.
        //   השווי הוא הסיגנל החזק ביותר שיש למשתמש על איכות שחקן,
        //   ולכן הוא ברירת המחדל — לא שם וגם לא סדר אלפביתי.
        if (pricing) {
          const d = (b.p.price ?? 0) - (a.p.price ?? 0);
          if (d !== 0) return d;
        }
        const f = (b.p.form ?? 0) - (a.p.form ?? 0);
        if (f !== 0) return f;
        // שובר שוויון קבוע — הרשימה לא "רוקדת" בין פתיחות.
        return a.p.id.localeCompare(b.p.id);
      });
  }, [pool, slot.position, query, lineup, rules, teamById, pricing, remaining, browse, openTeam]);

  const available = candidates.filter((c) => !c.block.blocked && !c.tooExpensive).length;

  return (
    <div
      className="fixed inset-0 z-sheet flex items-end bg-night/70 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`בחירת ${POSITION_LABEL[slot.position]}`}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[86dvh] w-full overflow-hidden rounded-t-3xl bg-night-2
                   pb-[env(safe-area-inset-bottom)] motion-safe:animate-slideUp
                   lg:mx-auto lg:mb-8 lg:max-w-lg lg:rounded-3xl"
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-chalk/25" />

        <div className="px-4 py-3">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-lg font-black">
              בחירת {POSITION_LABEL[slot.position]}
            </h2>
            <span className="text-xs text-chalk-dim">
              <span dir="ltr" className="num">{available}</span> זמינים
            </span>
          </div>

          <p className="mt-1 text-[11px] text-chalk-dim">
            שחקנים מקבוצה שכבר בחרת מוצגים מואפרים — שחקן אחד מכל קבוצה.
            {remaining !== undefined && (
              <>
                {' '}נותרו <span dir="ltr" className="num text-toto">{remaining.toFixed(1)}</span>M€.
              </>
            )}
          </p>

          {/* ★ שתי דרכי חיפוש. ברירת המחדל היא הרשימה — היא מהירה
              יותר. "לפי קבוצה" קיימת למי שחושב קודם על המשחקים. */}
          <div className="mt-3 flex gap-1 rounded-full bg-night p-1">
            {([
              ['players', 'לפי שחקן'],
              ['teams', 'לפי קבוצה'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => { setBrowse(id); setOpenTeam(null); }}
                className={`tap flex-1 rounded-full py-1.5 text-xs font-black
                            transition-colors duration-200 ease-brand ${
                              browse === id ? 'bg-toto text-night' : 'text-chalk-dim'
                            }`}
              >
                {label}
              </button>
            ))}
          </div>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש שחקן או קבוצה…"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            className="tap mt-3 w-full rounded-full bg-night px-4 text-start text-chalk
                       placeholder:text-chalk-dim focus:outline-none focus:ring-2 focus:ring-toto"
          />
        </div>

        {/* ---- בחירת קבוצה ---- */}
        {browse === 'teams' && !openTeam ? (
          <TeamGrid
            teams={teams}
            pool={pool}
            position={slot.position}
            lineup={lineup}
            rules={rules}
            opponentShortByTeam={opponentShortByTeam}
            onPick={setOpenTeam}
          />
        ) : (
        <>
        {browse === 'teams' && openTeam && (
          <button
            onClick={() => setOpenTeam(null)}
            className="tap mx-4 mb-2 flex items-center gap-1.5 rounded-full bg-night px-3 py-1.5
                       text-xs font-black text-chalk-dim"
          >
            <span aria-hidden>→</span> כל הקבוצות
            <span className="text-chalk">· {teamById.get(openTeam)?.name}</span>
          </button>
        )}
        <ul className="max-h-[60dvh] overflow-y-auto overscroll-contain px-2 pb-4">
          {candidates.map(({ p, block, tooExpensive }) => {
            const team = teamById.get(p.teamId);
            const occupant = block.occupiedBy ? nameOf.get(block.occupiedBy) : undefined;
            return (
              <li key={p.id}>
                <button
                  disabled={block.blocked || tooExpensive}
                  onClick={() => onSelect(p)}
                  aria-disabled={block.blocked || tooExpensive}
                  className={[
                    'tap flex w-full items-center gap-3 rounded-xl px-2 text-start',
                    'transition-colors duration-200 ease-brand',
                    block.blocked
                      // ★ האפרה + קו חוצה: ברור מיד שאי אפשר, ולמה
                      ? 'cursor-not-allowed opacity-45 grayscale'
                      : tooExpensive
                        // יקר מדי הוא מצב אחר: השחקן זמין, התקציב לא.
                        // לכן מעומעם אך לא אפור — ההבדל מכוון.
                        ? 'cursor-not-allowed opacity-55'
                        : 'active:bg-night-3',
                  ].join(' ')}
                >
                  <span className={[
                    'grid size-8 shrink-0 place-items-center rounded-lg text-[10px] font-bold',
                    block.blocked ? 'bg-night-3 text-chalk-dim' : 'bg-night-3',
                  ].join(' ')}>
                    {team?.short}
                  </span>
                  <span className="min-w-0 flex-1">
                    <bdi className={[
                      'block truncate text-sm font-bold',
                      block.blocked ? 'line-through decoration-flare/70' : '',
                    ].join(' ')}>
                      {p.name}
                    </bdi>
                    <span className="block truncate text-[11px] text-chalk-dim">
                      {block.blocked
                        ? occupant
                          ? `${team?.name} · כבר בחרת את ${occupant}`
                          : `${team?.name} · ${block.reasonHe}`
                        : tooExpensive
                          ? `${team?.name} · חסרים ${((p.price ?? 0) - (remaining ?? 0)).toFixed(1)}M€`
                          : opponentShortByTeam?.[p.teamId]
                            ? `${team?.name} · נגד ${opponentShortByTeam[p.teamId]}`
                            : team?.name}
                    </span>
                  </span>
                  {block.blocked ? (
                    <span aria-hidden className="text-sm text-flare">✕</span>
                  ) : pricing && p.price !== undefined ? (
                    <span
                      dir="ltr"
                      className={[
                        'num shrink-0 rounded-lg px-2 py-1 text-xs font-bold',
                        tooExpensive ? 'bg-flare/15 text-flare' : 'bg-toto/15 text-toto',
                      ].join(' ')}
                    >
                      {p.price}M€
                    </span>
                  ) : p.form !== undefined ? (
                    <span dir="ltr" className="num text-sm text-toto">{p.form.toFixed(1)}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
        </>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/* בחירה לפי קבוצה                                                     */
/* ================================================================== */

/**
 * ★ הברִיף מבקש "כרטיסי קבוצה מבוססי לוגו". אין לנו לוגואים
 *   מורשים, ולכן הכרטיס בנוי מהערכה עצמה: צבע המועדון כרקע,
 *   קיצור השם בדיו שנבחר לפי ניגודיות מדודה. התוצאה מזוהה מיד
 *   ולא מפרה זכויות של אף מועדון.
 *
 * קבוצה שכבר תפוסה בהרכב מוצגת נעולה במקום להיעלם — אותו עיקרון
 * שמנחה את רשימת השחקנים.
 */
function TeamGrid({
  teams, pool, position, lineup, rules, opponentShortByTeam, onPick,
}: {
  teams: TeamMeta[];
  pool: PoolPlayer[];
  position: Position;
  lineup: Lineup;
  rules: RuleSet;
  opponentShortByTeam?: Record<string, string>;
  onPick: (teamId: string) => void;
}) {
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pool) {
      if (p.position === position) m.set(p.teamId, (m.get(p.teamId) ?? 0) + 1);
    }
    return m;
  }, [pool, position]);

  return (
    <ul className="grid max-h-[60dvh] grid-cols-3 gap-2 overflow-y-auto overscroll-contain
                   px-3 pb-4 sm:grid-cols-4">
      {teams.map((t) => {
        const block = teamBlock(lineup, t.id, rules);
        const n = counts.get(t.id) ?? 0;
        const kit = teamColor(t.id);
        return (
          <li key={t.id}>
            <button
              disabled={block.blocked || n === 0}
              onClick={() => onPick(t.id)}
              className={[
                'tap flex w-full flex-col items-center gap-1 rounded-2xl px-2 py-3',
                'ring-1 ring-inset ring-chalk/10 transition-transform duration-200 ease-brand',
                block.blocked || n === 0
                  ? 'cursor-not-allowed opacity-40 grayscale'
                  : 'active:scale-[0.97]',
              ].join(' ')}
              style={{ background: kit.primary }}
            >
              <span
                className="font-poster text-lg leading-none"
                style={{ color: kit.ink }}
              >
                {t.short}
              </span>
              <span className="text-[10px] font-bold" style={{ color: kit.ink, opacity: 0.75 }}>
                {block.blocked
                  ? 'תפוס'
                  : opponentShortByTeam?.[t.id]
                    ? `נגד ${opponentShortByTeam[t.id]}`
                    : `${n} שחקנים`}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
