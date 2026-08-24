/**
 * AdminPanel.tsx — לוח הניהול האחורי.
 *
 * זה בדיוק מה שמחליף API כדורגל עד שמתחברים לאחד: האדמין מזין תוצאה
 * סופית לכל משחק במחזור + סטטיסטיקת שחקנים (דקות, שערים, בישולים,
 * כרטיסים), והמסך שומר את זה כ-`TeamOutcome`/`PlayerPerformance` —
 * בדיוק הטיפוסים שמנוע הניקוד (`scoreLineup`) כבר יודע לקרוא. ברגע
 * שיוזן API אמיתי, השכבה היחידה שמוחלפת היא זו שממלאת את הטפסים.
 */
import { useMemo, useState } from 'react';

import { TEAMS, TEAM_BY_ID, PLAYERS_BY_TEAM } from '../data/squads.ts';
import { FIXTURES, GAMEWEEK, fixtureLabel, kickoffTimeLabel } from '../data/fixtures.ts';
import {
  getResults, upsertFixtureScore, upsertPerformance, setPublished,
  tryAdminLogin, isAdminSession, adminLogout, subscribeToStore,
} from '../lib/store.ts';
import type { PlayerPerformance, Position, TeamOutcome } from '../lib/scoring/types.ts';

const POSITION_LABEL: Record<Position, string> = {
  GK: 'שוער', DEF: 'הגנה', MID: 'קישור', FWD: 'התקפה',
};

function emptyPerf(playerId: string, teamId: string, position: Position): PlayerPerformance {
  return {
    playerId, teamId, position,
    minutes: 0, goals: 0, assists: 0, ownGoals: 0,
    yellowCards: 0, redCards: 0, saves: 0,
    penaltiesSaved: 0, penaltiesMissed: 0, goalsConceded: 0,
    cleanSheet: false, played: false,
  };
}

export function AdminPanel({ onExit }: { onExit: () => void }) {
  const [, forceTick] = useState(0);
  const [authed, setAuthed] = useState(isAdminSession());
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  const [openFixture, setOpenFixture] = useState<string | null>(null);

  useMemo(() => {
    const unsub = subscribeToStore(() => forceTick((n) => n + 1));
    return unsub;
  }, []);

  if (!authed) {
    return (
      <div dir="rtl" className="grid h-[100dvh] place-items-center bg-night px-6 text-chalk">
        <form
          className="w-full max-w-xs rounded-2xl border border-gold/15 bg-night-2 p-6"
          onSubmit={(e) => {
            // האימות אסינכרוני מאז שהסיסמה הוחלפה ב-hash (ראו store.ts).
            e.preventDefault();
            void tryAdminLogin(pin).then((ok) => {
              setAuthed(ok);
              setPinError(!ok);
              if (!ok) setPin('');
            });
          }}
        >
          <div className="mx-auto mb-3 h-1 w-12 rounded-full bg-gold" />
          <h1 className="text-center font-display text-xl font-black">לוח ניהול · דוביד</h1>
          <p className="mt-1 text-center text-xs text-chalk-dim">
            כניסת צוות בלבד — קוד גישה זמני עד שיחובר אימות אמיתי.
          </p>
          <input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="קוד גישה"
            className="mt-5 w-full rounded-xl border border-gold/25 bg-night px-3 py-2.5 text-center
                       text-chalk outline-none focus:border-gold"
            autoFocus
          />
          {pinError && (
            <p className="mt-2 text-center text-xs text-flare">קוד שגוי, נסו שוב.</p>
          )}
          <button
            type="submit"
            className="tap mt-4 w-full rounded-full bg-gold py-2.5 font-poster text-night"
          >
            כניסה
          </button>
          <button
            type="button"
            onClick={onExit}
            className="mt-3 w-full text-center text-xs text-chalk-dim underline underline-offset-2"
          >
            חזרה לאפליקציה
          </button>
        </form>
      </div>
    );
  }

  const results = getResults(GAMEWEEK.id);

  return (
    <div dir="rtl" className="h-[100dvh] overflow-y-auto bg-night text-chalk">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b
                          border-gold/15 bg-night/95 px-4 py-3 backdrop-blur">
        <div>
          <h1 className="font-display text-lg font-black">לוח ניהול</h1>
          <p className="text-xs text-chalk-dim">
            {GAMEWEEK.label} · {GAMEWEEK.seasonLabel} ·{' '}
            <span className={results.published ? 'text-gold' : 'text-chalk-dim'}>
              {results.published ? 'התוצאות פורסמו' : 'טיוטה — עוד לא פורסם'}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPublished(GAMEWEEK.id, !results.published)}
            className={`tap rounded-full px-4 py-2 text-sm font-black transition-colors ${
              results.published ? 'bg-chalk/10 text-chalk' : 'bg-gold text-night'
            }`}
          >
            {results.published ? 'בטל פרסום' : 'פרסם דירוג'}
          </button>
          <button
            onClick={() => { adminLogout(); onExit(); }}
            className="tap rounded-full border border-gold/25 px-3 py-2 text-xs text-chalk-dim"
          >
            יציאה
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-5">
        <p className="mb-4 rounded-xl border border-tekhelet/30 bg-tekhelet/10 px-4 py-3 text-[13px] text-chalk-2">
          מלאו תוצאה סופית לכל משחק, ואז פתחו אותו כדי להזין דקות / שערים / בישולים / כרטיסים
          לכל שחקן. הדירוג בעמוד &quot;דירוג&quot; מחושב חי מהנתונים כאן — ברגע שמפרסמים, המשתמשים
          רואים ניקוד עדכני. זה בדיוק המקום שיוחלף בחיבור API כדורגל בהמשך.
        </p>

        <div className="space-y-3">
          {FIXTURES.map((f) => {
            const score = results.fixtureScores[f.id];
            const open = openFixture === f.id;
            return (
              <div key={f.id} className="overflow-hidden rounded-2xl border border-gold/15 bg-night-2">
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <div className="text-sm font-bold">{fixtureLabel(f)}</div>
                    <div className="text-[11px] text-chalk-dim">
                      {f.dayLabel} · <span className="num">{kickoffTimeLabel(f.kickoff, f.timeConfirmed)}</span>
                    </div>
                  </div>
                  <FixtureScoreForm fixture={f} existing={score} />
                  <button
                    onClick={() => setOpenFixture(open ? null : f.id)}
                    className="tap rounded-full border border-gold/25 px-3 py-1.5 text-xs text-chalk-2"
                  >
                    {open ? 'סגירה' : 'הזנת שחקנים'}
                  </button>
                </div>
                {open && (
                  <div className="grid grid-cols-1 gap-4 border-t border-gold/15 bg-night p-4 sm:grid-cols-2">
                    <TeamStatEntry teamId={f.homeTeamId} gameweekId={GAMEWEEK.id} performances={results.performances} />
                    <TeamStatEntry teamId={f.awayTeamId} gameweekId={GAMEWEEK.id} performances={results.performances} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-8 text-[11px] text-chalk-dim">
          קבוצות בליגה: {TEAMS.length} · שחקנים בסגלים: {Object.values(PLAYERS_BY_TEAM).reduce((s, t) => s + t.players.length, 0)}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function FixtureScoreForm({
  fixture, existing,
}: {
  fixture: (typeof FIXTURES)[number];
  existing: ReturnType<typeof getResults>['fixtureScores'][string] | undefined;
}) {
  const [home, setHome] = useState(existing?.homeGoals ?? 0);
  const [away, setAway] = useState(existing?.awayGoals ?? 0);

  const save = () => {
    const homeOutcome: TeamOutcome = {
      teamId: fixture.homeTeamId,
      result: home > away ? 'W' : home === away ? 'D' : 'L',
      goalsFor: home,
      goalsAgainst: away,
    };
    const awayOutcome: TeamOutcome = {
      teamId: fixture.awayTeamId,
      result: away > home ? 'W' : home === away ? 'D' : 'L',
      goalsFor: away,
      goalsAgainst: home,
    };
    upsertFixtureScore(
      GAMEWEEK.id,
      { fixtureId: fixture.id, homeGoals: home, awayGoals: away, final: true },
      [homeOutcome, awayOutcome],
    );
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="number" min={0} inputMode="numeric" value={home}
        onChange={(e) => setHome(Math.max(0, Number(e.target.value) || 0))}
        className="num w-12 rounded-lg border border-gold/25 bg-night px-2 py-1.5 text-center"
      />
      <span className="text-chalk-dim">:</span>
      <input
        type="number" min={0} inputMode="numeric" value={away}
        onChange={(e) => setAway(Math.max(0, Number(e.target.value) || 0))}
        className="num w-12 rounded-lg border border-gold/25 bg-night px-2 py-1.5 text-center"
      />
      <button
        onClick={save}
        className="tap rounded-full bg-gold/90 px-3 py-1.5 text-xs font-black text-night"
      >
        שמירה
      </button>
      {existing?.final && <span className="text-xs text-gold">✓</span>}
    </div>
  );
}

function TeamStatEntry({
  teamId, gameweekId, performances,
}: {
  teamId: string;
  gameweekId: string;
  performances: Record<string, PlayerPerformance>;
}) {
  const team = TEAM_BY_ID.get(teamId);
  const players = useMemo(
    () => PLAYERS_BY_TEAM.find((t) => t.team.id === teamId)?.players ?? [],
    [teamId],
  );

  return (
    <div>
      <h3 className="mb-2 text-sm font-black text-chalk">{team?.nameHe}</h3>
      <div className="max-h-72 space-y-1.5 overflow-y-auto pe-1">
        {players.map((p) => (
          <PlayerStatRow
            key={p.id}
            playerId={p.id}
            teamId={teamId}
            position={p.position}
            name={p.nameHe}
            gameweekId={gameweekId}
            existing={performances[p.id]}
          />
        ))}
      </div>
    </div>
  );
}

function PlayerStatRow({
  playerId, teamId, position, name, gameweekId, existing,
}: {
  playerId: string; teamId: string; position: Position; name: string;
  gameweekId: string; existing: PlayerPerformance | undefined;
}) {
  const [perf, setPerf] = useState<PlayerPerformance>(existing ?? emptyPerf(playerId, teamId, position));
  const [expanded, setExpanded] = useState(false);

  const save = (next: PlayerPerformance) => {
    setPerf(next);
    upsertPerformance(gameweekId, next);
  };

  const active = perf.played || perf.minutes > 0 || perf.goals > 0 || perf.assists > 0
    || perf.yellowCards > 0 || perf.redCards > 0 || perf.cleanSheet;

  return (
    <div className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
      active ? 'border-gold/40 bg-gold/5' : 'border-gold/15 bg-night-2'
    }`}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-start"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded bg-chalk/10 px-1.5 py-0.5 text-[10px] text-chalk-dim">
            {POSITION_LABEL[position]}
          </span>
          <span className="truncate">{name}</span>
        </span>
        {active && (
          <span className="num shrink-0 text-gold">
            {perf.goals > 0 && `⚽${perf.goals} `}
            {perf.assists > 0 && `🎯${perf.assists} `}
            {perf.yellowCards > 0 && '🟨'}
            {perf.redCards > 0 && '🟥'}
          </span>
        )}
      </button>

      {expanded && (
        <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-chalk-dim">דקות</span>
            <select
              value={perf.minutes}
              onChange={(e) => {
                const minutes = Number(e.target.value);
                save({ ...perf, minutes, played: minutes > 0 });
              }}
              className="rounded border border-gold/25 bg-night px-1 py-1"
            >
              <option value={0}>0</option>
              <option value={30}>30</option>
              <option value={60}>60</option>
              <option value={90}>90</option>
            </select>
          </label>
          <NumField label="שערים" value={perf.goals} onChange={(v) => save({ ...perf, goals: v })} />
          <NumField label="בישולים" value={perf.assists} onChange={(v) => save({ ...perf, assists: v })} />
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-chalk-dim">צהוב</span>
            <input
              type="checkbox" checked={perf.yellowCards > 0}
              onChange={(e) => save({ ...perf, yellowCards: e.target.checked ? 1 : 0 })}
              className="h-6 w-6"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-chalk-dim">אדום</span>
            <input
              type="checkbox" checked={perf.redCards > 0}
              onChange={(e) => save({ ...perf, redCards: e.target.checked ? 1 : 0 })}
              className="h-6 w-6"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-chalk-dim">שער נקי</span>
            <input
              type="checkbox" checked={perf.cleanSheet}
              onChange={(e) => save({ ...perf, cleanSheet: e.target.checked })}
              className="h-6 w-6"
            />
          </label>
        </div>
      )}
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] text-chalk-dim">{label}</span>
      <input
        type="number" min={0} inputMode="numeric" value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        className="num rounded border border-gold/25 bg-night px-1 py-1"
      />
    </label>
  );
}
