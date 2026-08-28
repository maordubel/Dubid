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
import { IS_PRODUCTION_DATA, PROJECT_ENV, PROJECT_ENV_HE } from '../lib/supabase.ts';

import { TEAMS, TEAM_BY_ID, PLAYERS_BY_TEAM } from '../data/squads.ts';
import { FIXTURES, GAMEWEEK, fixtureLabel, kickoffTimeLabel } from '../data/fixtures.ts';
import {
  getResults, upsertFixtureScore, upsertPerformance, setPublished,
  subscribeToStore, isDatabaseAdmin, errorMessageHe, hydrate,
  claimAdmin, releaseAdmin, runHealthChecks, getGameweekState,
  adminSetDeadline, adminSetStatus, adminUpsertFixture, storeStatus,
  adminMessageHe, type HealthCheck, type GameweekStatusCode,
} from '../lib/store.ts';
import {
  hydrateLiveData, subscribeToLiveData, liveDataVersion, liveDataStatus,
  currentGameweekCode,
} from '../lib/liveData.ts';
import type { PlayerPerformance, Position, TeamOutcome } from '../lib/scoring/types.ts';
import { AdminSquads } from './AdminSquads.tsx';
import {
  AdminGameweeks, AdminRules, AdminContent, AdminAnalytics, AdminActivity,
  AdminBots, AdminAds, AdminFunnel,
} from './AdminConsole.tsx';
import { LogoMark } from './Logo.tsx';
import { resolveGate, type AdminGate } from '../lib/adminGate.ts';
import { ensureIdentity } from '../lib/identity.ts';

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
  const [openFixture, setOpenFixture] = useState<string | null>(null);

  /**
   * ★★ מקור אמת אחד: המסד. ★★
   *
   * קודם היו שניים — דגל ב-`sessionStorage` ו-`is_admin` במסד —
   * והם נפרדו. סיסמה נכונה הדליקה את הדגל המקומי, הקריאה לשרת
   * נכשלה, והמשתמש נכנס למסך שבו **שום פעולה לא עובדת**, ומאז
   * גם דילג על מסך הכניסה בכל רענון.
   *
   * עכשיו אין דגל מקומי בכלל. ראו `lib/adminGate.ts`.
   */
  const [dbAdmin, setDbAdmin] = useState<boolean | null>(null);
  const [checked, setChecked] = useState(false);
  const gate: AdminGate = resolveGate({ isDatabaseAdmin: dbAdmin, checked });

  const recheck = () => {
    setChecked(false);
    void isDatabaseAdmin()
      .then(setDbAdmin)
      // ★ כישלון = לא אדמין. "לא הצלחתי לבדוק" אינו "כן".
      .catch(() => setDbAdmin(false))
      .finally(() => setChecked(true));
  };

  useEffect(recheck, []);

  /**
   * ★ שבע לשוניות, ולא אחת ארוכה.
   *
   * הלוח עושה עכשיו שבעה דברים שונים לגמרי. עמוד אחד עם כולם
   * הוא עמוד שגוללים בו ולא מוצאים. הסדר הוא לפי תדירות
   * השימוש האמיתית: תוצאות כל שבוע, מחזורים כל שבוע, סגלים
   * לפעמים, והשאר נדיר.
   */
  const [section, setSection] = useState<
    'results' | 'gameweeks' | 'gameweek' | 'squads' | 'rules' | 'content'
    | 'activity' | 'bots' | 'ads' | 'funnel' | 'stats'
  >('results');

  useEffect(() => subscribeToStore(() => forceTick((n) => n + 1)), []);

  /* ★ גם לרישום החי, ולא רק להגשות.
     בלי זה, עריכת סגל באדמין הייתה משנה את המסד ולא את המסך
     שממנו ערכו אותה — בדיוק התסמין שהמיגרציה באה לתקן. */
  useEffect(() => subscribeToLiveData(() => forceTick(liveDataVersion)), []);

  /**
   * ★★ הדאטה החיה **קודם**, ורק אחריה ההגשות. ★★
   *
   * קודם שתי הקריאות יצאו יחד, ולכן `GAMEWEEK.id` עדיין החזיק
   * את הזרע `'gw-2'` בזמן ש-`hydrate` נקראה. בטעינה ישירה של
   * `/admin` כשהמחזור הפעיל הוא gw-3, התוצאה הייתה לוח שמציג
   * את המצב של gw-2 — ושהכפתורים שלו פועלים על gw-3. האדמין
   * קרא מחזור אחד ופעל על אחר.
   */
  useEffect(() => {
    if (gate !== 'ready') return;
    let alive = true;
    void hydrateLiveData(true).then(() => {
      if (alive) void hydrate(currentGameweekCode() || GAMEWEEK.id, true);
    });
    return () => { alive = false; };
  }, [gate]);

  /* ★ בזמן הבדיקה לא מציגים כלום.
     מסך שמהבהב "אין הרשאה" ואז נפתח נראה שבור. */
  if (gate === 'checking') {
    return (
      <div dir="rtl" className="tex-wood grid h-[100dvh] place-items-center text-chalk">
        <div className="flex flex-col items-center gap-3">
          <LogoMark size={44} />
          <p className="text-[12px] text-chalk-dim">בודק הרשאה…</p>
        </div>
      </div>
    );
  }

  if (gate === 'locked') {
    return <AdminLogin onIn={recheck} onExit={onExit} />;
  }

  const results = getResults(GAMEWEEK.id);

  return (
    <div dir="rtl" className="tex-wood h-[100dvh] overflow-y-auto text-chalk">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b
                          border-gold/15 bg-night/95 px-4 py-3 backdrop-blur">
        <div>
          <h1 className="font-press text-lg font-black">לוח ניהול</h1>
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
              // ★ מכבה את הדגל **במסד** — זה המקום היחיד שבו הוא חי.
              void releaseAdmin().finally(onExit);
            }}
            className="tap rounded-full border border-gold/25 px-3 py-2 text-xs text-chalk-dim"
          >
            יציאה
          </button>
        </div>
      </header>

      {/*
        ★★ הפס שאומר לאיזה מסד הלוח הזה מחובר ★★

        לוח הניהול נראה זהה לחלוטין מול ייצור ומול בדיקות. זה
        המסך היחיד במוצר שאפשר למחוק ממנו מחזור, לשנות חוקי
        ניקוד ולהוסיף בוטים — כלומר המסך היחיד שבו "לא ידעתי
        שזה החי" הוא נזק אמיתי.

        ★ הפס אדום רק בייצור, ולא תמיד.
          אזהרה שמופיעה בכל מצב מפסיקה להיקרא תוך יומיים. כאן
          הצבע **הוא** המידע: ירוק = אפשר לשחק, אדום = זה החי.
      */}
      <div
        className="px-4 pt-3"
        style={{ direction: 'rtl' }}
      >
        <p
          className={`rounded-lg px-3 py-1.5 text-center text-[11.5px] font-black ${
            IS_PRODUCTION_DATA
              ? 'bg-flare/15 text-flare ring-1 ring-inset ring-flare/40'
              : 'bg-gold/10 text-chalk-dim'}`}
        >
          {IS_PRODUCTION_DATA ? '⚠ ' : ''}
          מחובר ל־{PROJECT_ENV_HE[PROJECT_ENV]}
          {IS_PRODUCTION_DATA && ' — כל שינוי כאן נראה למשתמשים מיד'}
        </p>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-5">
        {/* ★ גלילה אופקית: שבע לשוניות לא נכנסות לרוחב טלפון,
            והצטמצמות הייתה הופכת כל תווית לשתי אותיות. */}
        <div className="mb-4 flex gap-1 overflow-x-auto rounded-full bg-night-2 p-1 edge-gold
                        [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* ★ "פעילות" יושבת שלישית ולא אחרונה: זו הלשונית
              שנפתחת הכי הרבה אחרי תוצאות — היא עונה על "מה
              קורה עכשיו", וזו השאלה שפותחים בשבילה את הלוח. */}
          {/* ★★ "בוטים" ו"פרסום" הן לשוניות משלהן, ולא כרטיסים
              בתוך לשונית אחרת. ★★

              הבוטים ישבו בתחתית מסך "פעילות", ולכן — כפי שהתברר
              — הם פשוט לא נמצאו. תכונה שקיימת ואי אפשר למצוא
              אותה שווה בדיוק כמו תכונה שלא נבנתה, וזה נכון
              בכפליים בלוח ניהול: מי שמחפש בו משהו כבר יודע מה
              הוא רוצה, והוא מחפש **שם** ולא מגלה בגלילה. */}
          {([['results', 'תוצאות'], ['gameweeks', 'מחזורים'], ['activity', 'פעילות'],
             ['bots', 'בוטים'], ['ads', 'פרסום'], ['funnel', 'משפך'],
             ['gameweek', 'המחזור'], ['squads', 'סגלים'], ['rules', 'חוקים'],
             ['content', 'תוכן'], ['stats', 'ניתוח']] as const)
            .map(([id, label]) => (
              <button
                key={id}
                onClick={() => setSection(id)}
                className={`tap shrink-0 rounded-full px-3 py-2 text-[12.5px] font-black
                            transition-colors ${
                              section === id
                                ? 'bg-gradient-to-b from-gold-light to-gold text-gold-ink'
                                : 'text-chalk-dim'}`}
              >
                {label}
              </button>
            ))}
        </div>

        {section === 'squads' && <AdminSquads />}
        {section === 'gameweeks' && <AdminGameweeks />}
        {section === 'activity' && <AdminActivity />}
        {section === 'bots' && <AdminBots />}
        {section === 'ads' && <AdminAds />}
        {section === 'funnel' && <AdminFunnel />}
        {section === 'gameweek' && <AdminGameweek />}
        {section === 'rules' && <AdminRules />}
        {section === 'content' && <AdminContent />}
        {section === 'stats' && (
          <div className="space-y-4">
            <AdminAnalytics />
            <AdminHealth />
          </div>
        )}

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

        {/* ★ "מהשרת" ולא רק המספרים.
            אדמין שרואה 14/351 ולא יודע מאיפה הם הגיעו לא יכול
            לדעת אם מה שהוא עורך הוא מה שהמשתמשים רואים. */}
        <div className="mt-8 text-[11px] text-chalk-dim">
          קבוצות בליגה: {TEAMS.length} · שחקנים בסגלים:{' '}
          {Object.values(PLAYERS_BY_TEAM).reduce((s, t) => s + t.players.length, 0)}
          {' · '}
          <span className={liveDataStatus().fromServer ? 'text-gold' : 'text-flare'}>
            {liveDataStatus().fromServer ? 'מהשרת' : 'מהקובץ המקומי — אין חיבור'}
          </span>
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
  /**
   * ★ דלת החירום.
   *
   * אם המסד לא מכיר את הפונקציה שמעניקה הרשאה, אין שום סיסמה
   * שתעזור — ובלי מוצא, המסך הופך לקיר. אז מציגים את המזהה של
   * המשתמש הנוכחי ואת השורה המדויקת שמעניקה לו הרשאה ידנית.
   *
   * המזהה נשלף רק כשצריך: אין סיבה לחשוף אותו במסך רגיל.
   */
  const [myId, setMyId] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !pin) return;
    setBusy(true);
    setError(null);

    void (async () => {
      /**
       * ★ קריאה אחת בלבד, ולשרת.
       *
       * היה כאן גם שער מקומי שהשווה hash בדפדפן — "כדי לחסוך
       * הלוך-ושוב". הוא זה ששבר הכל: הוא הדליק דגל כניסה מקומי
       * גם כשהשרת נכשל, והמשתמש נכנס למסך שאי אפשר לפעול בו.
       *
       * חיסכון של 200 מילישניות לא שווה מצב שבו המסך פתוח
       * וההרשאה לא קיימת.
       */
      const res = await claimAdmin(pin);

      if (res.ok) { onIn(); return; }

      const code = res.error ?? 'NETWORK';
      setError(adminMessageHe(code));
      if (code === 'NO_SECRET_CONFIGURED') {
        void ensureIdentity().then((id) => setMyId(id.id)).catch(() => {});
      }
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
              <h1 className="font-press text-lg font-black">בדיקת מערכת</h1>
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
          <h1 className="mt-3 font-press text-xl font-black">לוח ניהול</h1>
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

        {/* ★ דלת החירום — מוצגת רק כשאין דרך אחרת. */}
        {myId && (
          <div className="mt-3 rounded-xl border border-armband/40 bg-armband/10 p-3">
            <p className="text-[11.5px] font-bold leading-snug text-armband">
              מוצא חלופי: להדביק את השורה הזו ב-SQL Editor של Supabase,
              והרשאת הניהול תינתן למשתמש הזה.
            </p>
            <code
              dir="ltr"
              className="mt-2 block select-all overflow-x-auto rounded-lg bg-night px-2.5 py-2
                         text-[10.5px] leading-relaxed text-gold-light"
            >
              UPDATE game.users SET is_admin = TRUE WHERE id = '{myId}';
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(
                  `UPDATE game.users SET is_admin = TRUE WHERE id = '${myId}';`,
                );
              }}
              className="mt-2 text-[11px] text-chalk-2 underline underline-offset-2"
            >
              להעתיק
            </button>
          </div>
        )}

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
        <h3 className="font-press text-base font-black text-chalk">בדיקת מערכת</h3>
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

/* ================================================================== */
/* מחזור — דדליין, סטטוס, ולוח משחקים                                   */
/* ================================================================== */

/**
 * ★ למה הלשונית הזו נוספה
 *
 * הדדליין והסטטוס היו קיימים במסד מהיום הראשון, ולא הייתה שום
 * דרך לגעת בהם חוץ מ-SQL Editor. כלומר: משחק שנדחה, מחזור
 * שצריך להיסגר מוקדם, או תקלה שדורשת פתיחה מחדש — כולם היו
 * "תפתח את Supabase ותכתוב UPDATE".
 *
 * ★ ומה **לא** נמצא כאן: שדה "מספר משתתפים" או "דירוג ידני".
 *   אלה נגזרים, ואדמין שיכול לערוך נגזרת יכול לשבור תחרות.
 */

const STATUS_OPTIONS: Array<[GameweekStatusCode, string, string]> = [
  ['open',     'פתוח',   'מקבל הגשות'],
  ['locked',   'נעול',   'לא מקבל הגשות'],
  ['live',     'משחקים', 'הכדור מתגלגל'],
  ['settled',  'הסתיים', 'הניקוד סופי'],
];

/** `datetime-local` דורש `YYYY-MM-DDTHH:mm` בשעון מקומי, בלי אזור. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
         `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function AdminGameweek() {
  const [, tick] = useState(0);
  useEffect(() => subscribeToStore(() => tick((n) => n + 1)), []);
  useEffect(() => subscribeToLiveData(() => tick(liveDataVersion)), []);

  const gw = getGameweekState();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [deadline, setDeadline] = useState(() => toLocalInput(gw?.lockAt ?? ''));

  // הדדליין מהשרת מנצח כל עוד לא נגעו בשדה.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched && gw?.lockAt) setDeadline(toLocalInput(gw.lockAt));
  }, [gw?.lockAt, touched]);

  const run = (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    setMsg(null);
    void fn()
      .then(() => setMsg(`${label} — נשמר`))
      .catch((e: unknown) =>
        setMsg(errorMessageHe(e instanceof Error ? e.message : 'NETWORK')))
      .finally(() => setBusy(false));
  };

  if (!gw) {
    return (
      <p className="rounded-xl border border-flare/30 bg-flare/5 px-4 py-3 text-[13px] text-chalk-2">
        המחזור <span className="num">{GAMEWEEK.id}</span> לא נמצא במסד.
        {storeStatus().error && <> קוד: <span className="num">{storeStatus().error}</span></>}
      </p>
    );
  }

  const locked = ['locked', 'live', 'settled'].includes(gw.status);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gold/15 bg-night-2 p-4">
        <h3 className="mb-1 text-sm font-black">מצב המחזור</h3>
        <p className="mb-3 text-[11.5px] leading-snug text-chalk-dim">
          זו הנעילה האמיתית. השרת בודק אותה לפני השעה — ולכן
          &rdquo;נעול&ldquo; חוסם הגשות מיד, גם אם הדדליין עוד לא הגיע.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_OPTIONS.map(([code, label, hint]) => (
            <button
              key={code}
              disabled={busy || gw.status === code}
              title={hint}
              onClick={() => run(label, () => adminSetStatus(GAMEWEEK.id, code))}
              className={`rounded-full px-3 py-1.5 text-[12px] font-bold transition-colors
                          disabled:opacity-45 ${
                            gw.status === code
                              ? 'bg-gold text-gold-ink'
                              : 'bg-night-3 text-chalk-2'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-chalk-dim">
          כרגע: <span className="font-bold text-chalk">{gw.status}</span>
          {' · '}משתתפים: <span className="num">{gw.entrants}</span>
        </p>
      </div>

      <div className="rounded-2xl border border-gold/15 bg-night-2 p-4">
        <h3 className="mb-1 text-sm font-black">דדליין</h3>
        {/* ★ ההסבר הזה חשוב יותר מהשדה.
            דדליין שנקבע ידנית מפסיק להיגזר מהמשחקים, ומי שלא יודע
            את זה יזיז משחק ויתפלא שהנעילה לא זזה איתו. */}
        <p className="mb-3 text-[11.5px] leading-snug text-chalk-dim">
          נגזר אוטומטית מהמשחק המוקדם ביותר במחזור. שינוי כאן דורס
          את החישוב עד להזזת המשחק הבא.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="datetime-local"
            value={deadline}
            disabled={busy}
            onChange={(e) => { setTouched(true); setDeadline(e.target.value); }}
            className="num flex-1 rounded-lg border border-gold/25 bg-night px-2 py-2
                       text-[13px] text-chalk outline-none focus:border-gold"
          />
          <button
            disabled={busy || !deadline}
            onClick={() => {
              const iso = new Date(deadline).toISOString();
              run('דדליין', () => adminSetDeadline(GAMEWEEK.id, iso).then(() => setTouched(false)));
            }}
            className="tap shrink-0 rounded-lg bg-gradient-to-b from-gold-light to-gold px-4
                       text-[12px] font-black text-gold-ink disabled:opacity-40"
          >
            שמירה
          </button>
        </div>
        <p className="mt-2 text-[11px] text-chalk-dim">
          במסד: <span className="num">{new Date(gw.lockAt).toLocaleString('he-IL')}</span>
          {locked && <span className="text-flare"> · המחזור כבר נעול</span>}
        </p>
      </div>

      <div className="rounded-2xl border border-gold/15 bg-night-2 p-4">
        <h3 className="mb-1 text-sm font-black">שעות המשחקים</h3>
        <p className="mb-3 text-[11.5px] leading-snug text-chalk-dim">
          הזזת משחק מזיזה את הדדליין אוטומטית, אם הוא נעשה המוקדם ביותר.
        </p>
        <div className="space-y-2">
          {FIXTURES.map((f) => (
            <FixtureTimeRow key={f.id} fixture={f} busy={busy} onRun={run} />
          ))}
        </div>
      </div>

      {msg && (
        <p className="rounded-xl border border-gold/25 bg-night px-4 py-2.5 text-[12.5px] text-chalk-2">
          {msg}
        </p>
      )}
    </div>
  );
}

function FixtureTimeRow({
  fixture, busy, onRun,
}: {
  fixture: (typeof FIXTURES)[number];
  busy: boolean;
  onRun: (label: string, fn: () => Promise<unknown>) => void;
}) {
  const [when, setWhen] = useState(() => toLocalInput(fixture.kickoff));
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!touched) setWhen(toLocalInput(fixture.kickoff));
  }, [fixture.kickoff, touched]);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gold/12
                    bg-night px-2.5 py-2">
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-chalk">
        <bdi>{fixtureLabel(fixture)}</bdi>
      </span>
      <input
        type="datetime-local"
        value={when}
        disabled={busy}
        onChange={(e) => { setTouched(true); setWhen(e.target.value); }}
        className="num rounded-lg border border-gold/25 bg-night-2 px-2 py-1.5
                   text-[12px] text-chalk outline-none focus:border-gold"
      />
      <button
        disabled={busy || !when || !touched}
        onClick={() => onRun('שעת משחק', () =>
          adminUpsertFixture(
            GAMEWEEK.id, fixture.homeTeamId, fixture.awayTeamId,
            new Date(when).toISOString(),
          ).then(() => setTouched(false)))}
        className="tap shrink-0 rounded-lg border border-gold/25 px-3 py-1.5 text-[11.5px]
                   font-bold text-chalk-2 disabled:opacity-35"
      >
        עדכון
      </button>
    </div>
  );
}
