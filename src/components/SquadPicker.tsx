/**
 * SquadPicker.tsx — בחירת סגל עם מפת כיסוי קבוצות.
 *
 * הרעיון המרכזי: המשתמש לא אמור *לגלות* את החוק דרך הודעת שגיאה.
 * הוא אמור לראות אותו כל הזמן. לכן מעל המגרש יש רצועת "כיסוי קבוצות"
 * שמראה בכל רגע אילו מ-14 הקבוצות כבר מיוצגות ואילו עוד פנויות,
 * ובגיליון הבחירה שחקנים מקבוצה תפוסה מוצגים נעולים ולא נעלמים —
 * ככה המשתמש מבין למה, ורואה את מי הוא צריך להחליף.
 */
import { useMemo, useState } from 'react';
import {
  teamCoverage, validateLineup, formatIssue, teamBlock,
} from '../lib/scoring/validate.ts';
import { Jersey, jerseyMonogram } from './Jersey.tsx';
import { teamColor } from '../data/teamColors.ts';
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
}

export function SquadPicker(props: SquadPickerProps) {
  const {
    lineup, pool, teams, rules, onAssign, onClear, onCaptain, onSubmit,
    opponentShortByTeam, pricing, budget, onVice,
  } = props;
  const [picking, setPicking] = useState<LineupSlot | null>(null);

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

  const rows: Position[] = ['GK', 'DEF', 'MID', 'FWD'];

  return (
    <div className="flex h-full flex-col">
      {/* ---- מפת כיסוי הקבוצות ---- */}
      <TeamCoverageStrip coverage={coverage} teamById={teamById} />

      {/* ---- מחוון התקציב — דביק, תמיד נראה ---- */}
      {budget !== undefined && (
        <BudgetBar budget={budget} spent={spent} filled={filled} size={rules.constraints.lineupSize} />
      )}

      {/* ---- המגרש ---- */}
      <div className="flex-1 px-3 pb-4">
        <div className="mx-auto w-full max-w-3xl rounded-3xl p-3 tex-turf
                        ring-1 ring-inset ring-chalk/15">
          {rows.map((row) => {
            const slots = lineup.slots.filter((s) => s.position === row && !s.isBench);
            if (!slots.length) return null;
            return (
              <section key={row} aria-label={POSITION_LABEL[row]} className="mb-4 last:mb-1">
                <h2 className="mb-1.5 ps-1 text-[10px] font-bold tracking-[0.2em] text-chalk/70">
                  {POSITION_LABEL[row]}
                </h2>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(84px,1fr))] gap-2.5">
                  {slots.map((slot) => (
                    <SlotCard
                      key={slot.slotNo}
                      slot={slot}
                      player={pool.find((p) => p.id === slot.playerId)}
                      team={teamById.get(slot.teamId)}
                      pricing={pricing}
                      onPick={() => setPicking(slot)}
                      onClear={() => onClear(slot.slotNo)}
                      onCaptain={() => slot.playerId && onCaptain(slot.playerId)}
                      onVice={onVice && slot.playerId ? () => onVice(slot.playerId) : undefined}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        {/* הבעיה הראשונה בלבד — לא שופכים על המשתמש רשימת שגיאות */}
        {!ready && filled === rules.constraints.lineupSize && (
          <p role="alert" className="mx-auto mt-3 max-w-3xl rounded-xl bg-flare/12 px-3 py-2
                                     text-sm text-flare">
            {formatIssue(issues[0], 'he')}
          </p>
        )}
      </div>

      {/* ---- CTA צף ---- */}
      <div className="sticky bottom-0 border-t border-chalk/10 bg-night/95 px-4
                      pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <button
          onClick={onSubmit}
          disabled={!ready}
          className="tap h-14 w-full rounded-full bg-toto font-poster text-xl text-night
                     transition-transform duration-200 ease-brand active:scale-[.98]
                     disabled:bg-night-3 disabled:text-chalk-dim"
        >
          {ready
            ? 'נעילת ההרכב'
            : `נותרו ${rules.constraints.lineupSize - filled} שחקנים`}
        </button>
      </div>

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
/* רצועת כיסוי הקבוצות — הרכיב שהופך את האילוץ למשחק                   */
/* ================================================================== */

function TeamCoverageStrip({
  coverage, teamById,
}: {
  coverage: ReturnType<typeof teamCoverage>;
  teamById: Map<string, TeamMeta>;
}) {
  const done = coverage.filter((c) => c.filled).length;
  return (
    <div className="shrink-0 px-3 pb-2 pt-3">
      <div className="mx-auto flex max-w-3xl items-center justify-between pb-1.5">
        <span className="text-[11px] font-bold tracking-widest text-chalk-dim">
          כיסוי קבוצות
        </span>
        <span dir="ltr" className="num text-xs text-chalk-dim">
          {done}/{coverage.length}
        </span>
      </div>

      {/* גלילה אופקית במובייל, שורה מלאה בדסקטופ */}
      <ul className="mx-auto flex max-w-3xl gap-1.5 overflow-x-auto pb-1
                     [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {coverage.map((c) => {
          const meta = teamById.get(c.teamId);
          return (
            <li
              key={c.teamId}
              title={meta?.name}
              aria-label={`${meta?.name ?? c.teamId}: ${c.filled ? 'אויש' : 'פנוי'}`}
              className={[
                'grid h-8 min-w-[42px] shrink-0 place-items-center rounded-lg px-2',
                'text-[11px] font-bold transition-colors duration-200 ease-brand',
                c.filled
                  ? 'bg-toto text-night'
                  : 'bg-night-3 text-chalk-dim ring-1 ring-inset ring-chalk/10',
              ].join(' ')}
            >
              {meta?.short ?? c.teamId}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ================================================================== */
/* מחוון תקציב                                                         */
/* ================================================================== */

/**
 * ★ הברִיף: "תמיד להציג תקציב שנותר · מחוון צף/דביק · עדכון מיידי
 *   · להראות בבירור כשאי אפשר להרשות שחקן".
 *
 * שלוש החלטות שכדאי להסביר:
 *
 *  1. **מציגים את הנותר, לא את המנוצל.** "נותרו 4M" הוא המספר
 *     שהמשתמש מקבל בו החלטה. "בזבזת 11M" הוא טריוויה.
 *
 *  2. **הפס מתמלא ולא מתרוקן.** מילוי = התקדמות. פס שמתרוקן
 *     מייצר חרדה בכל בחירה, וזה ההפך מ"מהיר וכיפי".
 *
 *  3. **חריגה היא מצב מוצג, לא שגיאה קופצת.** המשתמש רואה מספר
 *     אדום ויודע בדיוק כמה להוריד — בלי טוסט שנעלם.
 */
function BudgetBar({
  budget, spent, filled, size,
}: { budget: number; spent: number; filled: number; size: number }) {
  const remaining = budget - spent;
  const over = remaining < 0;
  const pct = Math.max(0, Math.min(100, (spent / budget) * 100));

  // כמה נשאר *לשחקן* מבין אלה שעוד לא נבחרו. זה המספר שבאמת
  // עוזר: "נותרו 4M לשני שחקנים" הוא מידע, "נותרו 4M" הוא חצי מידע.
  const left = size - filled;
  const perPlayer = left > 0 ? remaining / left : null;

  return (
    <div className="sticky top-0 z-20 shrink-0 border-b border-chalk/10 bg-night/95 px-3 py-2
                    backdrop-blur">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-bold tracking-widest text-chalk-dim">תקציב</span>
          <span className="flex items-baseline gap-1.5">
            <span
              dir="ltr"
              className={`num text-lg font-black leading-none ${over ? 'text-flare' : 'text-toto'}`}
            >
              {over ? remaining.toFixed(1) : remaining.toFixed(1)}M
            </span>
            <span className="text-[11px] text-chalk-dim">
              {over ? 'חריגה' : 'נותרו'}
            </span>
          </span>
        </div>

        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-night-3">
          <div
            className={`h-full rounded-full transition-[width] duration-300 ease-brand ${
              over ? 'bg-flare' : 'bg-toto'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="mt-1 flex justify-between text-[10px] text-chalk-dim">
          <span>
            <span dir="ltr" className="num">{spent.toFixed(1)}</span>
            {' / '}
            <span dir="ltr" className="num">{budget}</span>M€
          </span>
          {perPlayer !== null && !over && (
            <span>
              עד <span dir="ltr" className="num">{perPlayer.toFixed(1)}</span>M לכל אחד מ-
              <span dir="ltr" className="num">{left}</span> הנותרים
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/* משבצת שחקן                                                          */
/* ================================================================== */

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
        className="tap flex flex-col items-center gap-1.5 rounded-2xl py-2
                   text-chalk/50 transition-colors duration-200 ease-brand
                   active:text-toto"
      >
        <span className="relative grid place-items-center">
          <Jersey ghost position={slot.position} size={52} />
          <span className="absolute text-2xl leading-none">+</span>
        </span>
        <span className="rounded-full border border-dashed border-chalk/25 px-2.5 py-1
                          text-[10px] font-bold">
          {POSITION_LABEL[slot.position]}
        </span>
      </button>
    );
  }

  const cap = !!slot.isCaptain;
  const vice = !!slot.isVice;
  const price = pricing && player.price !== undefined ? player.price : undefined;

  return (
    <div className="relative flex flex-col items-center gap-1">
      {/* ✕ הסרה — פינה עליונה, כמו במסכי ההשראה */}
      <button
        onClick={onClear}
        aria-label="הסר שחקן"
        className="tap absolute -top-1 end-1 z-10 grid size-6 place-items-center
                   rounded-full bg-flare text-[11px] font-black text-white shadow-md"
      >
        ✕
      </button>

      {/* קפטן — פינה עליונה השנייה, בהשראת התג הסגול של FPL */}
      <button
        onClick={onCaptain}
        aria-pressed={cap}
        aria-label={cap ? 'הסר קפטן' : 'הפוך לקפטן'}
        className={[
          'tap absolute -top-1 start-1 z-10 grid size-6 place-items-center rounded-full',
          'text-[10px] font-black shadow-md transition-colors duration-200 ease-brand',
          cap ? 'bg-armband text-night' : 'bg-night/80 text-chalk-dim',
        ].join(' ')}
      >
        C
      </button>

      {/* ★ סגן — רשת ביטחון לקפטן שלא ירד למגרש.
          מוצג רק כשהמשבצת אינה הקפטן עצמו: שחקן אחד לא יכול
          להיות גם קפטן וגם הסגן של עצמו. */}
      {onVice && !cap && (
        <button
          onClick={onVice}
          aria-pressed={vice}
          aria-label={vice ? 'הסר סגן' : 'הפוך לסגן קפטן'}
          className={[
            'tap absolute -top-1 start-8 z-10 grid size-6 place-items-center rounded-full',
            'text-[10px] font-black shadow-md transition-colors duration-200 ease-brand',
            vice ? 'bg-tekhelet text-white' : 'bg-night/80 text-chalk-dim',
          ].join(' ')}
        >
          V
        </button>
      )}

      <button onClick={onPick} className="tap grid place-items-center drop-shadow-md">
        <Jersey
          teamId={team?.id}
          position={slot.position}
          monogram={jerseyMonogram(team?.short)}
          size={56}
          captain={cap}
        />
      </button>

      {cap && (
        <span className="rounded-md bg-armband px-1.5 py-0.5 font-poster text-[10px] text-night">
          קפטן ×3
        </span>
      )}
      {vice && !cap && (
        <span className="rounded-md bg-tekhelet px-1.5 py-0.5 font-poster text-[10px] text-white">
          סגן
        </span>
      )}

      {/* לוחית שם — קופסה לבנה כמו בכל המסכים שסופקו */}
      <div className="w-full max-w-[92px] rounded-lg bg-chalk px-1.5 py-1 text-center shadow-sm">
        <bdi className="line-clamp-1 text-[11px] font-black leading-tight text-night">
          {player.nameShort}
        </bdi>
      </div>

      {/* תג תחתון — מחיר ב-5 על 5, אחרת קיצור קבוצה */}
      <div className={[
        'w-full max-w-[92px] rounded-lg px-1.5 py-0.5 text-center text-[10px] font-bold',
        price !== undefined ? 'bg-toto/15 text-toto' : 'bg-night-3 text-chalk-dim',
      ].join(' ')}>
        {price !== undefined ? <span className="num" dir="ltr">{price}M€</span> : team?.short}
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
