/**
 * FixturesStrip.tsx — "מי משחק מול מי" במחזור הנוכחי.
 *
 * מוצג גם בעמוד הבית וגם מעל בורר ההרכב, כדי שהבחירה תיעשה מתוך ידיעה
 * מי בכלל משחק השבוע — לא רק מי נחשב "טוב" באופן כללי.
 */
import { TEAM_BY_ID } from '../data/squads.ts';
import { FIXTURES, GAMEWEEK, kickoffDateLabel, kickoffTimeLabel } from '../data/fixtures.ts';

export function FixturesStrip({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'px-3 pt-3' : 'mx-auto max-w-2xl px-4 pt-4'}>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="font-display text-sm font-black text-chalk">
          {GAMEWEEK.label} · לוח המשחקים
        </h2>
        <span className="text-[11px] text-chalk-dim">{GAMEWEEK.seasonLabel}</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {FIXTURES.map((f) => {
          const home = TEAM_BY_ID.get(f.homeTeamId);
          const away = TEAM_BY_ID.get(f.awayTeamId);
          return (
            <div
              key={f.id}
              className="flex w-40 shrink-0 flex-col gap-1.5 rounded-xl border border-gold/15
                         bg-night-2 px-3 py-2.5"
            >
              <div className="flex items-center justify-between text-[10px] text-chalk-dim">
                <span>{f.dayLabel}</span>
                <span className="num">{kickoffDateLabel(f.kickoff)}</span>
              </div>
              <div className="flex items-center justify-between text-xs font-bold text-chalk">
                <span className="truncate">{home?.short}</span>
                <span className="text-chalk-dim">–</span>
                <span className="truncate">{away?.short}</span>
              </div>
              <div className={`text-center text-[11px] ${f.timeConfirmed ? 'num text-gold' : 'text-chalk-dim'}`}>
                {kickoffTimeLabel(f.kickoff, f.timeConfirmed)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
