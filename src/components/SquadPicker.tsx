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
}

export function SquadPicker(props: SquadPickerProps) {
  const { lineup, pool, teams, rules, onAssign, onClear, onCaptain, onSubmit, opponentShortByTeam } = props;
  const [picking, setPicking] = useState<LineupSlot | null>(null);

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
                <div className="grid grid-cols-[repeat(auto-fit,minmax(74px,1fr))] gap-2">
                  {slots.map((slot) => (
                    <SlotCard
                      key={slot.slotNo}
                      slot={slot}
                      player={pool.find((p) => p.id === slot.playerId)}
                      team={teamById.get(slot.teamId)}
                      onPick={() => setPicking(slot)}
                      onClear={() => onClear(slot.slotNo)}
                      onCaptain={() => slot.playerId && onCaptain(slot.playerId)}
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
/* משבצת שחקן                                                          */
/* ================================================================== */

function SlotCard({
  slot, player, team, onPick, onClear, onCaptain,
}: {
  slot: LineupSlot;
  player?: PoolPlayer;
  team?: TeamMeta;
  onPick: () => void;
  onClear: () => void;
  onCaptain: () => void;
}) {
  if (!player) {
    return (
      <button
        onClick={onPick}
        aria-label={`הוסף ${POSITION_LABEL[slot.position]}`}
        className="tap flex aspect-[3/4] flex-col items-center justify-center gap-1
                   rounded-xl border-2 border-dashed border-chalk/35 text-chalk/60
                   transition-colors duration-200 ease-brand active:border-toto active:text-toto"
      >
        <span className="text-2xl leading-none">+</span>
        <span className="text-[10px]">{POSITION_LABEL[slot.position]}</span>
      </button>
    );
  }

  const cap = !!slot.isCaptain;
  return (
    <div
      className={[
        'relative flex aspect-[3/4] flex-col items-center justify-center gap-0.5 rounded-xl p-1 text-center',
        cap ? 'bg-armband text-night ring-4 ring-night' : 'bg-chalk text-night',
      ].join(' ')}
    >
      <button
        onClick={onCaptain}
        aria-pressed={cap}
        aria-label={cap ? 'הסר קפטן' : 'הפוך לקפטן'}
        className={[
          'tap absolute -top-2 grid size-7 place-items-center rounded-full text-[11px] font-black',
          'start-[-6px] transition-colors duration-200 ease-brand',
          cap ? 'bg-night text-armband' : 'bg-night/85 text-chalk-dim',
        ].join(' ')}
      >
        C
      </button>

      {cap && (
        <span dir="ltr" className="absolute -top-2 end-[-6px] rounded-md
                                   bg-night px-1.5 py-0.5 font-poster text-[10px] text-armband">
          x3
        </span>
      )}

      <button
        onClick={onClear}
        aria-label="הסר שחקן"
        className="tap absolute bottom-0 end-0 grid size-7 place-items-center
                   text-night/45"
      >
        ×
      </button>

      <bdi className="line-clamp-2 px-1 text-[12px] font-black leading-tight">
        {player.nameShort}
      </bdi>
      <span className="text-[10px] opacity-60">{team?.short}</span>
    </div>
  );
}

/* ================================================================== */
/* גיליון בחירת שחקן                                                   */
/* ================================================================== */

function PlayerSheet({
  slot, pool, teamById, lineup, rules, onClose, onSelect, opponentShortByTeam,
}: {
  slot: LineupSlot;
  pool: PoolPlayer[];
  teamById: Map<string, TeamMeta>;
  lineup: Lineup;
  rules: RuleSet;
  onClose: () => void;
  onSelect: (p: PoolPlayer) => void;
  opponentShortByTeam?: Record<string, string>;
}) {
  const [query, setQuery] = useState('');

  const nameOf = useMemo(
    () => new Map(pool.map((p) => [p.id, p.nameShort])),
    [pool],
  );

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pool
      .filter((p) => p.position === slot.position)
      .filter((p) => {
        if (!q) return true;
        const team = teamById.get(p.teamId);
        return p.name.toLowerCase().includes(q) || (team?.name ?? '').toLowerCase().includes(q);
      })
      // ★ החסימה מגיעה מ-teamBlock, שמחזיר גם *מי* תופס את הקבוצה —
      //   כדי שנוכל לומר "כבר בחרת את אצילי" ולא רק להאפיר בלי הסבר.
      .map((p) => ({ p, block: teamBlock(lineup, p.teamId, rules) }))
      // חסומים יורדים לסוף אבל לא נעלמים: משתמש צריך להבין למה, לא לחפש
      .sort((a, b) =>
        Number(a.block.blocked) - Number(b.block.blocked) || (b.p.form ?? 0) - (a.p.form ?? 0));
  }, [pool, slot.position, query, lineup, rules, teamById]);

  const available = candidates.filter((c) => !c.block.blocked).length;

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
          </p>

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

        <ul className="max-h-[60dvh] overflow-y-auto overscroll-contain px-2 pb-4">
          {candidates.map(({ p, block }) => {
            const team = teamById.get(p.teamId);
            const occupant = block.occupiedBy ? nameOf.get(block.occupiedBy) : undefined;
            return (
              <li key={p.id}>
                <button
                  disabled={block.blocked}
                  onClick={() => onSelect(p)}
                  aria-disabled={block.blocked}
                  className={[
                    'tap flex w-full items-center gap-3 rounded-xl px-2 text-start',
                    'transition-colors duration-200 ease-brand',
                    block.blocked
                      // ★ האפרה + קו חוצה: ברור מיד שאי אפשר, ולמה
                      ? 'cursor-not-allowed opacity-45 grayscale'
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
                        : opponentShortByTeam?.[p.teamId]
                          ? `${team?.name} · נגד ${opponentShortByTeam[p.teamId]}`
                          : team?.name}
                    </span>
                  </span>
                  {block.blocked ? (
                    <span aria-hidden className="text-sm text-flare">✕</span>
                  ) : p.form !== undefined ? (
                    <span dir="ltr" className="num text-sm text-toto">{p.form.toFixed(1)}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
