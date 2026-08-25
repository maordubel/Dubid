/**
 * AdminPanel.tsx — לוח הניהול האחורי.
 *
 * זה בדיוק מה שמחליף API כדורגל עד שמתחברים לאחד: האדמין מזין תוצאה
 * סופית לכל משחק במחזור + סטטיסטיקת שחקנים (דקות, שערים, בישולים,
 * כרטיסים), והמסך שומר את זה כ-`TeamOutcome`/`PlayerPerformance` —
 * בדיוק הטיפוסים שמנוע הניקוד (`scoreLineup`) כבר יודע לקרוא. ברגע
 * שיוזן API אמיתי, השכבה היחידה שמוחלפת היא זו שממלאת את הטפסים.
 */
import { useEffect, useMemo, useState } from 'react';

import { TEAMS, TEAM_BY_ID, PLAYERS_BY_TEAM } from '../data/squads.ts';
import { FIXTURES, GAMEWEEK, fixtureLabel, kickoffTimeLabel } from '../data/fixtures.ts';
import {
  getResults, upsertFixtureScore, upsertPerformance, setPublished,
  tryAdminLogin, isAdminSession, adminLogout, subscribeToStore,
  isDatabaseAdmin, errorMessageHe, hydrate,
  claimAdmin, releaseAdmin, runHealthChecks,
  adminMessageHe, type HealthCheck,
} from '../lib/store.ts';
import type { PlayerPerformance, Position, TeamOutcome } from '../lib/scoring/types.ts';
import { AdminSquads } from './AdminSquads.tsx';
import { LogoMark } from './Logo.tsx';

const POSITION_LABEL: Record<Position, string> = {
  GK: 'שוער', DEF: 'הגנה', MID: 'קישור', FWD: 'התקפה',
};

/**
 * ★ המפתח של תוצאת משחק.
 *
 * הקליינט מכיר `gw2-3`; המסד לא. שניהם כן מכירים את זוג הקבוצות.
 * הפונקציה הזו היא החוזה, והיא חייבת להישאר זהה למה ש-
 * `game.results()` בונה ב-db/09.
 */
function fixtureKey(homeTeamId: string, awayTeamId: string): string {
  return `${homeTeamId}-${awayTeamId}`;
}

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
  const [openFixture, setOpenFixture] = useState<string | null>(null);
  /**
   * ★ שתי הרשאות שונות, ורק אחת מהן אמיתית.
   *
   * ה-PIN פותח את המסך. ההרשאה **במסד** היא מה שמאפשר לשמור. הן
   * יכולות להיפרד: מי שיודע את הקוד אבל אינו אדמין ב-`game.users`
   * יראה מסך מלא, ילחץ שמירה, ויקבל `ADMIN_REQUIRED` על כל שדה.
   *
   * לכן זה נבדק פעם אחת בכניסה ונאמר במפורש, במקום להתגלות
   * בשגיאה השלישית.
   */
  const [dbAdmin, setDbAdmin] = useState<boolean | null>(null);
  /**
   * ★ שתי משימות שונות לגמרי, ולכן שתי לשוניות.
   *
   *   תוצאות — נעשה פעם בשבוע, אחרי המחזור, בלחץ זמן.
   *   סגלים  — נעשה לפני העונה ואחרי חלון העברות, בנחת.
   *
   * ערבוב שלהן במסך אחד היה מכריח את מי שממהר להזין תוצאות
   * לגלול מעבר ל-351 שחקנים.
   */
  const [section, setSection] = useState<'results' | 'squads' | 'health'>('results');

  useMemo(() => {
    const unsub = subscribeToStore(() => forceTick((n) => n + 1));
    return unsub;
  }, []);

  useEffect(() => {
    if (!authed) return;
    void hydrate(GAMEWEEK.id, true);
    void isDatabaseAdmin().then(setDbAdmin);
  }, [authed]);

  if (!authed) {
    return (
      <AdminLogin
        onIn={() => { setAuthed(true); setDbAdmin(true); }}
        onExit={onExit}
      />
    );
  }

  const results = getResults(GAMEWEEK.id);

  return (
    <div dir="rtl" className="tex-wood h-[100dvh] overflow-y-auto text-chalk">
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
            onClick={() => {
              void setPublished(GAMEWEEK.id, !results.published).catch((e: unknown) => {
                window.alert(errorMessageHe(e instanceof Error ? e.message : 'NETWORK'));
              });
            }}
            className={`tap rounded-full px-4 py-2 text-sm font-black transition-colors ${
              results.published ? 'bg-chalk/10 text-chalk' : 'bg-gold text-night'
            }`}
          >
            {results.published ? 'בטל פרסום' : 'פרסם דירוג'}
          </button>
          <button
            onClick={() => {
              // ★ יציאה מכבה גם את הדגל במסד, לא רק את המסך.
              //   אחרת כל מכשיר שהוקלדה בו הסיסמה פעם אחת נשאר
              //   אדמין לנצח — כולל טלפון שהושאל לרגע.
              void releaseAdmin().finally(() => { adminLogout(); onExit(); });
            }}
            className="tap rounded-full border border-gold/25 px-3 py-2 text-xs text-chalk-dim"
          >
            יציאה
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-5">
        <div className="mb-4 flex gap-1 rounded-full bg-night-2 p-1 edge-gold">
          {([['results', 'תוצאות'], ['squads', 'סגלים'], ['health', 'בדיקת מערכת']] as const)
            .map(([id, label]) => (
              <button
                key={id}
                onClick={() => setSection(id)}
                className={`tap flex-1 rounded-full py-2 text-[13px] font-black transition-colors
                            ${section === id
                              ? 'bg-gradient-to-b from-gold-light to-gold text-gold-ink'
                              : 'text-chalk-dim'}`}
              >
                {label}
              </button>
            ))}
        </div>

        {dbAdmin === false && (
          <div role="alert" className="mb-4 rounded-xl border border-flare/40 bg-flare/10 px-4 py-3">
            <div className="text-sm font-black text-flare">אין לך הרשאת ניהול במסד</div>
            <p className="mt-1 text-[12.5px] leading-snug text-chalk-2">
              המסך נפתח, אבל כל שמירה תידחה. ההרשאה נבדקת בשרת ולא כאן —
              וזה מכוון. להפעלה, פעם אחת, מה-SQL Editor של Supabase:
            </p>
            <code dir="ltr" className="mt-2 block overflow-x-auto rounded-lg bg-night px-3 py-2
                                       text-[11px] text-gold-light">
              UPDATE game.users SET is_admin = TRUE WHERE id = auth.uid();
            </code>
          </div>
        )}

        {section === 'squads' && <AdminSquads />}
        {section === 'health' && <AdminHealth />}

        {section === 'results' && (<>
        <p className="mb-4 rounded-xl border border-tekhelet/30 bg-tekhelet/10 px-4 py-3 text-[13px] text-chalk-2">
          מלאו תוצאה סופית לכל משחק, ואז פתחו אותו כדי להזין דקות / שערים / בישולים / כרטיסים
          לכל שחקן. הכל נשמר ב-Supabase — ברגע שמפרסמים, כל המשתמשים רואים את הדירוג
          המעודכן, גם בלי לרענן. זה המקום שיוחלף בחיבור API כדורגל בהמשך.
        </p>

        <div className="space-y-3">
          {FIXTURES.map((f) => {
            const score = results.fixtureScores[fixtureKey(f.homeTeamId, f.awayTeamId)];
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
        </>)}
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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
    setBusy(true);
    setErr(null);
    void upsertFixtureScore(
      GAMEWEEK.id,
      {
        fixtureId: fixtureKey(fixture.homeTeamId, fixture.awayTeamId),
        homeGoals: home, awayGoals: away, final: true,
      },
      [homeOutcome, awayOutcome],
    )
      .catch((e: unknown) => setErr(errorMessageHe(e instanceof Error ? e.message : 'NETWORK')))
      .finally(() => setBusy(false));
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
        disabled={busy}
        className="tap rounded-full bg-gold/90 px-3 py-1.5 text-xs font-black text-gold-ink
                   disabled:opacity-50"
      >
        {busy ? '…' : 'שמירה'}
      </button>
      {existing?.final && !err && <span className="text-xs text-gold">✓</span>}
      {err && <span className="text-[11px] text-flare">{err}</span>}
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

  const [err, setErr] = useState<string | null>(null);

  /**
   * ★ המסך מתעדכן מיד, השרת אחריו.
   *
   * הזנת סטטיסטיקה היא עשרות שדות ברצף. לחכות לשרת אחרי כל תו
   * הופך את המסך לבלתי שמיש. לכן העדכון המקומי מיידי, והכישלון —
   * אם יש — מוצג ליד השורה עצמה ולא כהודעה גלובלית שאי אפשר לקשר
   * לשום שדה.
   */
  const save = (next: PlayerPerformance) => {
    setPerf(next);
    setErr(null);
    void upsertPerformance(gameweekId, next)
      .catch((e: unknown) => setErr(errorMessageHe(e instanceof Error ? e.message : 'NETWORK')));
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
        {err && <span className="shrink-0 text-[10px] text-flare">שגיאה</span>}
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


/* ================================================================== */
/* מסך הכניסה                                                          */
/* ================================================================== */

/**
 * ★ מסך אחד, שדה אחד, ושום דבר אחר.
 *
 * הגרסה הקודמת פתחה את המסך על סמך השוואת hash **בדפדפן**, ואז
 * דרשה שלב שני נפרד — `UPDATE game.users SET is_admin` ב-SQL
 * Editor — כדי שאפשר יהיה בכלל לשמור. מי שעשה רק את הראשון קיבל
 * לוח ניהול מלא שבו כל לחיצה נכשלת.
 *
 * עכשיו הסיסמה נבדקת בשרת (`game.claim_admin`), ואותה בדיקה גם
 * מעניקה את ההרשאה. **סיסמה אחת, שלב אחד, בלי SQL.**
 *
 * ★ ומה עם האבטחה: הבדיקה בשרת היא שקובעת. מי שיערוך את הקוד
 *   בדפדפן יוכל לפתוח את המסך — ולא יוכל לשמור כלום, כי כל
 *   פונקציית אדמין במסד בודקת `game.is_admin()` בשורה הראשונה.
 */
function AdminLogin({ onIn, onExit }: { onIn: () => void; onExit: () => void }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [triesLeft, setTriesLeft] = useState<number | null>(null);
  /**
   * ★ מסך כניסה שאפשר להיתקע בו הוא מסך שבור.
   *
   * הגרסה הראשונה הציגה "השרת לא ענה" ונגמרה שם. בדיקת המערכת
   * הייתה **בתוך** לוח הניהול — כלומר מעבר לדלת שלא נפתחת.
   * מי שהסיבה שלו היא סכימה לא חשופה לא יכול היה לגלות את זה.
   *
   * עכשיו הבדיקות זמינות מהמסך הזה, בלי להיכנס.
   */
  const [showHealth, setShowHealth] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !pin) return;
    setBusy(true);
    setError(null);

    void (async () => {
      // שער מקומי — חוסך הלוך-ושוב על שגיאת הקלדה. הוא **לא**
      // האבטחה; הוא רק מהיר יותר.
      const localOk = await tryAdminLogin(pin);
      const res = await claimAdmin(pin);

      if (res.ok) { onIn(); return; }

      // סיסמה שגויה מקומית **וגם** השרת לא ענה → זו כנראה באמת
      // סיסמה שגויה, ואין טעם להאשים את השרת.
      const code = !localOk && res.error === 'NETWORK' ? 'BAD_SECRET' : (res.error ?? 'NETWORK');
      setError(adminMessageHe(code));
      setTriesLeft(res.triesLeft ?? null);
      // תקלת תשתית → פותחים את הבדיקות מיד. הוא ממילא הולך לשם.
      if (code !== 'BAD_SECRET' && code !== 'LOCKED') setShowHealth(true);
      setPin('');
      setBusy(false);
    })();
  };

  if (showHealth) {
    return (
      <div dir="rtl" className="tex-wood h-[100dvh] overflow-y-auto px-5 py-6 text-chalk">
        <div className="mx-auto max-w-md">
          <div className="mb-4 flex items-center gap-3">
            <LogoMark size={34} />
            <div className="flex-1">
              <h1 className="font-display text-lg font-black">בדיקת מערכת</h1>
              <p className="text-[11px] text-chalk-dim">
                מה חסר כדי שהשרת יעבוד
              </p>
            </div>
            <button
              onClick={() => { setShowHealth(false); setError(null); }}
              className="tap rounded-full border border-gold/30 px-3 py-1.5 text-[12px]
                         font-bold text-gold-light"
            >
              חזרה
            </button>
          </div>
          <AdminHealth />
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="tex-wood grid h-[100dvh] place-items-center px-6 text-chalk">
      <form onSubmit={submit} className="w-full max-w-xs">
        <div className="flex flex-col items-center">
          <LogoMark size={52} />
          <h1 className="mt-3 font-display text-xl font-black">לוח ניהול</h1>
          <p className="mt-1 text-center text-[12px] text-chalk-dim">
            כניסת צוות. הסיסמה גם פותחת את המסך וגם נותנת הרשאה במסד.
          </p>
        </div>

        <input
          type="password"
          value={pin}
          onChange={(e) => { setPin(e.target.value); setError(null); }}
          placeholder="סיסמה"
          autoFocus
          autoComplete="current-password"
          disabled={busy}
          className="mt-6 w-full rounded-xl border border-gold/25 bg-night px-3 py-3 text-center
                     text-chalk outline-none focus:border-gold disabled:opacity-50"
        />

        {error && (
          <p role="alert" className="mt-2 text-center text-[12px] font-bold leading-snug text-flare">
            {error}
            {triesLeft !== null && triesLeft > 0 && (
              <span className="ms-1 font-normal text-chalk-dim">
                (נותרו <span className="num">{triesLeft}</span>)
              </span>
            )}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !pin}
          className="tap mt-4 w-full rounded-full bg-gradient-to-b from-gold-light to-gold
                     py-3 font-poster text-lg text-gold-ink disabled:opacity-40"
        >
          {busy ? 'בודק…' : 'כניסה'}
        </button>

        {/* ★ תמיד זמין, לא רק אחרי כישלון. */}
        <button
          type="button"
          onClick={() => setShowHealth(true)}
          className="mt-4 w-full text-center text-[12px] text-gold-light underline underline-offset-2"
        >
          בדיקת מערכת — מה חסר בשרת
        </button>

        <button
          type="button"
          onClick={onExit}
          className="mt-2 w-full text-center text-[12px] text-chalk-dim underline underline-offset-2"
        >
          חזרה לאפליקציה
        </button>
      </form>
    </div>
  );
}

/* ================================================================== */
/* בדיקת מערכת                                                         */
/* ================================================================== */

/**
 * ★ חמש חוליות, ואיזו מהן נפלה.
 *
 * "אין חיבור לשרת" יכול לנבוע מחמישה דברים שונים, וכל אחד מהם
 * מתוקן במקום אחר בלוח הבקרה של Supabase. המסך הזה בודק כל
 * חוליה בנפרד ואומר את התיקון המדויק — במקום להשאיר אותך לנחש.
 */
function AdminHealth() {
  const [checks, setChecks] = useState<HealthCheck[] | null>(null);
  const [busy, setBusy] = useState(false);

  const run = () => {
    setBusy(true);
    void runHealthChecks().then(setChecks).finally(() => setBusy(false));
  };

  useEffect(run, []);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-base font-black text-chalk">בדיקת מערכת</h3>
        <button
          onClick={run}
          disabled={busy}
          className="tap rounded-full border border-gold/30 px-3 py-1.5 text-[12px]
                     font-bold text-gold-light disabled:opacity-40"
        >
          {busy ? 'בודק…' : 'לבדוק שוב'}
        </button>
      </div>

      {!checks ? (
        <p className="py-6 text-center text-sm text-chalk-dim">בודק…</p>
      ) : (
        <div className="space-y-1.5">
          {checks.map((c) => (
            <div
              key={c.id}
              className={`rounded-xl border px-3 py-2.5 ${
                c.ok === true ? 'border-gold/20 bg-night-2'
                : c.ok === false ? 'border-flare/40 bg-flare/5'
                : 'border-chalk/10 bg-night-2/50'
              }`}
            >
              <div className="flex items-center gap-2">
                <span aria-hidden className={
                  c.ok === true ? 'text-gold' : c.ok === false ? 'text-flare' : 'text-chalk-dim'
                }>
                  {c.ok === true ? '✓' : c.ok === false ? '✕' : '—'}
                </span>
                <span className="flex-1 text-[13px] font-black text-chalk">{c.label}</span>
              </div>
              <p className="mt-0.5 ps-5 text-[11.5px] text-chalk-2">{c.detail}</p>
              {c.fix && (
                <p className="mt-1 ps-5 text-[11px] leading-snug text-armband">
                  ← {c.fix}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-[11px] leading-snug text-chalk-dim">
        הבדיקות רצות בסדר התלות. אם חוליה נפלה, מה שתלוי בה מסומן
        &quot;—&quot; ולא נבדק — כדי שלא תרדוף אחרי חמש שגיאות שכולן
        נובעות מאותו מקור.
      </p>
    </div>
  );
}
