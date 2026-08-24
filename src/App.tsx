/**
 * App.tsx — חיווט הפלטפורמה המאוחדת.
 *
 * דוביד שוויצר = מנוע הניקוד + PWA + מיתוג של dubid-web, מחובר לסגל
 * המלא (14 קבוצות · 350 שחקנים) שהיה בפרויקט ה-5x5, פלוס לוח משחקים
 * אמיתי למחזור הנוכחי ולוח ניהול אחורי (`/#admin`) שמזין תוצאות עד
 * שיתחבר API כדורגל. שני החלקים חיים עכשיו באותו קוד, אותו מנוע ניקוד,
 * אותה שפת עיצוב — לא שתי אפליקציות מודבקות זו לזו.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { AppShell, AppHeader } from './components/AppShell.tsx';
import type { NavItem } from './components/BottomNav.tsx';
import { Lobby, type LobbyMode } from './components/Lobby.tsx';
import { GameweekStatus, type Gameweek } from './lib/gameweek.ts';
import { serverNow } from './lib/serverTime.ts';
import { SquadPicker, type PoolPlayer, type TeamMeta } from './components/SquadPicker.tsx';
import { ShareCard } from './components/ShareCard.tsx';
import { Leaderboard } from './components/Leaderboard.tsx';
import { AdminPanel } from './components/AdminPanel.tsx';
import { LockedLineup } from './components/LockedLineup.tsx';
import { GameStatusBadge } from './components/GameStatusBadge.tsx';

import { LEAGUE, TEAMS, PLAYERS, shortName, TEAM_BY_ID } from './data/squads.ts';
import { GAMEWEEK, GAMEWEEK_DEADLINE, FIRST_KICKOFF, OPPONENT_BY_TEAM } from './data/fixtures.ts';
import { resolveRules, DUBID_5X5, DUBID_5X5_BUDGET } from './lib/scoring/rules.ts';
import { scoreLineup, rankGameweek } from './lib/scoring/engine.ts';
import { checkLeagueCapacity, formatIssue } from './lib/scoring/validate.ts';
import { useLineup } from './state/useLineup.ts';
import {
  getResults, saveEntry, listEntries, findMyEntry, deleteEntry, subscribeToStore, type LineupEntry,
} from './lib/store.ts';
import { computeGameStatus, STATUS_ACTION, type GameStatus } from './lib/gameStatus.ts';
import type { PlayerPerformance, TeamOutcome } from './lib/scoring/types.ts';
import type { RuleSet } from './lib/scoring/rules.ts';
import type { ShareCardData } from './lib/shareCard.ts';

type Mode = 'full' | 'five';
const MODE_LABEL: Record<Mode, string> = { full: 'הרכב מלא · 11', five: '5 על 5' };

const SITE_URL = 'https://dubid.dubelteam.com';
const USER_STORAGE_KEY = 'dubid.username.v1';

const NAV: NavItem[] = [
  { id: 'home', label: 'בית', icon: '⚑' },
  { id: 'lineup', label: 'ההרכב', icon: '◎' },
  { id: 'leaderboard', label: 'דירוג', icon: '▦' },
  { id: 'card', label: 'הכרטיס', icon: '◐' },
  { id: 'rules', label: 'חוקים', icon: '☰' },
];

function useHashRoute() {
  const [hash, setHash] = useState(() => (typeof window !== 'undefined' ? window.location.hash : ''));
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

export function App() {
  const hash = useHashRoute();
  if (hash === '#admin') {
    return <AdminPanel onExit={() => { window.location.hash = ''; }} />;
  }
  return <MainApp />;
}

function MainApp() {
  const [tab, setTab] = useState('home');
  const [mode, setMode] = useState<Mode>('full');
  const [, tick] = useState(0);
  useEffect(() => subscribeToStore(() => tick((n) => n + 1)), []);

  const resolved = useMemo(() => resolveRules(TEAMS.length), []);
  const fullRules = resolved.rules;
  const fiveRules = DUBID_5X5;
  const rulesByMode: Record<Mode, RuleSet> = { full: fullRules, five: fiveRules };
  const capacityIssue = useMemo(
    () => checkLeagueCapacity(TEAMS.length, { ...fullRules, constraints: { ...fullRules.constraints, lineupSize: 11 } }),
    [fullRules],
  );

  const teams: TeamMeta[] = useMemo(
    () => TEAMS.map((t) => ({ id: t.id, short: t.short, name: t.nameHe })),
    [],
  );
  const pool: PoolPlayer[] = useMemo(
    () => PLAYERS.map((p) => ({
      id: p.id,
      teamId: p.teamId,
      position: p.position,
      name: p.nameHe,
      nameShort: shortName(p.nameHe),
      price: p.price,
    })),
    [],
  );
  const priceById = useMemo(() => new Map(PLAYERS.map((p) => [p.id, p.price])), []);

  /** "נגד מי משחקים" — לתצוגה בגיליון בחירת השחקן, לפי מחזור נוכחי. */
  const opponentShortByTeam: Record<string, string> = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of TEAMS) {
      const opp = OPPONENT_BY_TEAM[t.id];
      if (opp) map[t.id] = TEAM_BY_ID.get(opp.opponentId)?.short ?? '';
    }
    return map;
  }, []);

  const [userId] = useState(() => {
    if (typeof localStorage === 'undefined') return 'guest';
    try {
      const existing = localStorage.getItem(USER_STORAGE_KEY);
      if (existing) return existing;
      const fresh = `guest-${Math.floor(Math.random() * 1e6)}`;
      localStorage.setItem(USER_STORAGE_KEY, fresh);
      return fresh;
    } catch {
      return 'guest';
    }
  });

  // שני הרכבים חיים תמיד, במקביל — לא נוצרים/נהרסים עם מעבר טאב,
  // כדי שהעבודה על אחד לא תימחק כשעוברים לשני ואז חוזרים.
  const luFull = useLineup(fullRules.constraints.formationAllowed[0], fullRules, {
    lineupId: 'draft-full', userId, gameweekId: GAMEWEEK.id,
  });
  const luFive = useLineup(fiveRules.constraints.formationAllowed[0], fiveRules, {
    lineupId: 'draft-5x5', userId, gameweekId: GAMEWEEK.id,
  });
  const luByMode = { full: luFull, five: luFive };
  const lu = luByMode[mode];
  const rules = rulesByMode[mode];

  const fiveCost = useMemo(
    () => (mode === 'five'
      ? lu.lineup.slots.reduce((sum, s) => sum + (s.playerId ? priceById.get(s.playerId) ?? 0 : 0), 0)
      : 0),
    [mode, lu.lineup, priceById],
  );
  const overBudget = mode === 'five' && fiveCost > DUBID_5X5_BUDGET;

  /* ---------------- קלטי הלובי ---------------- */

  const displayName = (() => {
    try { return localStorage.getItem('dubid.displayname.v1') || undefined; }
    catch { return undefined; }
  })();

  const results = getResults(GAMEWEEK.id);

  /**
   * ★ מחזור הדגמה עד שהמסד מחובר.
   *   הדדליין נגזר מ-`GAMEWEEK` הקיים; אין כאן מקור אמת שני.
   *   ברגע שהמחזורים מגיעים מ-Supabase, השורה הזו מתחלפת בשאילתה
   *   והלובי לא משתנה בכלל — הוא כבר מקבל `Gameweek` מלא.
   */
  const lobbyGameweek: Gameweek = useMemo(() => ({
    id: GAMEWEEK.id,
    number: GAMEWEEK.number ?? 1,
    label: GAMEWEEK.label,
    status: results.published
      ? GameweekStatus.Published
      : Date.parse(GAMEWEEK_DEADLINE) > serverNow()
        ? GameweekStatus.Open
        : GameweekStatus.Locked,
    deadlineAt: GAMEWEEK_DEADLINE,
    firstKickoffAt: FIRST_KICKOFF,
  }), [results.published]);

  const entrantCount = listEntries(GAMEWEEK.id).length;


  const hasRealResults = results.published && Object.keys(results.performances).length > 0;

  // ★ שכבת ה"נעילה": יש הגשה רשמית או שאין. כל עוד אין, המסך עורך את
  // הטיוטה. ברגע שיש — SquadPicker לא מוצג יותר, LockedLineup כן.
  const entryFull = findMyEntry(GAMEWEEK.id, 'full', userId);
  const entryFive = findMyEntry(GAMEWEEK.id, 'five', userId);
  const entryByMode: Record<Mode, LineupEntry | undefined> = { full: entryFull, five: entryFive };

  /**
   * שני הכרטיסים בלובי. המצב נגזר מאותם מקורות שכבר קיימים —
   * הטיוטה, ההגשה, והתוצאות. אין כאן state חדש.
   */
  const lobbyModes: LobbyMode[] = useMemo(() => (['five', 'full'] as const).map((m) => {
    const e = entryByMode[m];
    const draft = luByMode[m];
    const size = rulesByMode[m].constraints.lineupSize;
    const filled = draft.lineup.slots.filter((s) => s.playerId).length;
    const scored = e && hasRealResults;
    return {
      id: m,
      title: m === 'five' ? 'דוביד 5' : 'דוביד 11',
      tagline: m === 'five' ? 'בחרו 5. נצחו את כולם.' : 'בנו הרכב. שלטו בליגה.',
      state: scored ? 'scored' : e ? 'submitted' : filled > 0 ? 'draft' : 'empty',
      points: scored
        ? scoreLineup(e!.lineup, results.performances, results.outcomes, rulesByMode[m],
                      { validate: false }).totalPoints
        : undefined,
      filled,
      size,
    } as LobbyMode;
  }), [entryByMode, luByMode, rulesByMode, hasRealResults, results]);

  const entry = entryByMode[mode];

  const statusByMode: Record<Mode, GameStatus> = {
    full: computeGameStatus({
      hasSubmission: !!entryFull, resultsPublished: results.published,
      filled: luFull.filled, isComplete: luFull.isComplete,
    }),
    five: computeGameStatus({
      hasSubmission: !!entryFive, resultsPublished: results.published,
      filled: luFive.filled, isComplete: luFive.isComplete,
    }),
  };
  const status = statusByMode[mode];

  const [showSaveModal, setShowSaveModal] = useState(false);

  const goToMode = (m: Mode) => {
    setMode(m);
    setTab(statusByMode[m] === 'finished' ? 'card' : 'lineup');
  };

  const screens: Record<string, ReactNode> = {
    // ★ הלובי החליף את HomeScreen. הוא לא "עוד מסך בית" — הוא
    //   נקודת ההחלטה: שעון, שני מצבים, וכל השאר בשקט מתחת.
    home: (
      <Lobby
        gameweek={lobbyGameweek}
        nowMs={serverNow()}
        modes={lobbyModes}
        displayName={displayName}
        entrants={entrantCount}
        onPlay={goToMode}
        onLeagues={() => setTab('leaderboard')}
        onLeaderboard={() => setTab('leaderboard')}
      />
    ),
    /**
     * ★ מסך בניית ההרכב הוא עמודה בגובה קבוע, לא דף שנגלל.
     *
     * ה-`min-h-0` על העמודה ועל אזור ה-SquadPicker הוא מה שמאפשר
     * ל-flex לכווץ אותם. בלעדיו ילד עם תוכן גבוה דוחף את העמודה
     * מעבר למסך — וזה בדיוק מה שדחף את המגרש מתחת לקפל.
     *
     * מה ירד מהמסך הזה בכוונה: רצועת המשחקים. היריבה כבר מופיעה
     * ליד כל שחקן בגיליון הבחירה, ושורה שלמה עבורה עלתה בגובה
     * שהמגרש צריך יותר.
     */
    lineup: (
      <div className="flex h-full min-h-0 flex-col">
        <ModeSwitch mode={mode} onChange={setMode} />
        {entry ? (
          <LockedLineup
            lineup={entry.lineup}
            pool={pool}
            teams={teams}
            score={hasRealResults
              ? scoreLineup(entry.lineup, results.performances, results.outcomes, rules, { validate: false })
              : undefined}
            gameweekLabel={GAMEWEEK.label}
            submittedAt={entry.submittedAt}
            onUnlock={!results.published ? () => {
              if (window.confirm('לבטל את ההגשה ולחזור לעריכת ההרכב? ההגשה הנוכחית תימחק.')) {
                deleteEntry(entry.id);
              }
            } : undefined}
            onViewCard={hasRealResults ? () => setTab('card') : undefined}
          />
        ) : (
          <div className="relative flex min-h-0 flex-1 flex-col">
            {mode === 'full' && resolved.isDemo && capacityIssue && (
              <DemoBanner message={formatIssue(capacityIssue, 'he')} size={fullRules.constraints.lineupSize} />
            )}
            <SquadPicker
              key={mode}
              lineup={lu.lineup}
              pool={pool}
              teams={teams}
              rules={rules}
              onAssign={(slotNo, player) => lu.assign(slotNo, player)}
              onClear={lu.clear}
              onCaptain={lu.setCaptain}
              onVice={lu.setVice}
              onFormation={lu.setFormation}
              droppedNames={lu.lastDropped
                .map((id) => pool.find((p) => p.id === id)?.nameShort)
                .filter((n): n is string => !!n)}
              onSubmit={() => { if (!overBudget) setShowSaveModal(true); }}
              opponentShortByTeam={opponentShortByTeam}
              pricing={mode === 'five'}
              budget={mode === 'five' ? DUBID_5X5_BUDGET : undefined}
            />
          </div>
        )}
        {showSaveModal && (
          <SaveEntryModal
            onCancel={() => setShowSaveModal(false)}
            onSaved={() => { setShowSaveModal(false); setTab('card'); }}
            mode={mode}
            userId={userId}
            lineup={lu.lineup}
            priceById={priceById}
          />
        )}
      </div>
    ),
    card: (
      <>
        <ModeSwitch mode={mode} onChange={setMode} />
        <CardScreen
          lineup={entry ? entry.lineup : lu.lineup}
          pool={pool}
          teams={teams}
          rules={rules}
          ready={entry ? true : lu.isComplete}
          entry={entry}
        />
      </>
    ),
    leaderboard: <Leaderboard rulesByMode={rulesByMode} userId={userId} />,
    rules: <RulesScreen />,
  };

  return (
    <AppShell
      // רק מסך הבנייה מנהל גובה בעצמו. שאר המסכים נגללים כרגיל.
      fill={tab === 'lineup' && !entry}
      items={NAV}
      activeId={tab}
      onSelect={setTab}
      header={
        <AppHeader
          title="דוביד שוויצר"
          subtitle={
            <span className="flex items-center gap-2">
              <span>{LEAGUE.nameHe} · {GAMEWEEK.label} · {MODE_LABEL[mode]}</span>
              {tab !== 'home' && <GameStatusBadge status={status} />}
            </span>
          }
          right={
            <div className="text-end">
              <div className="num text-2xl text-toto">
                {lu.filled}/{rules.constraints.lineupSize}
              </div>
              <div className="text-[11px] text-chalk-dim">שחקנים</div>
            </div>
          }
        />
      }
    >
      {screens[tab]}
    </AppShell>
  );
}

/* ================================================================== */
/* מתג מצב משחק — הרכב מלא / 5 על 5, אותה תשתית משני צדי המתג          */
/* ================================================================== */

function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    // shrink-0: המחליף הוא כרום ולא תוכן. בלי זה הוא מתחרה
    // עם המגרש על הגובה שנשאר.
    <div className="mx-3 mt-2 flex shrink-0 gap-1.5 rounded-full bg-night-2 p-1">
      {(['full', 'five'] as const).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`tap flex-1 rounded-full py-1.5 text-[13px] font-black transition-colors duration-200 ease-brand ${
            mode === m ? 'bg-toto text-night' : 'text-chalk-dim'
          }`}
        >
          {MODE_LABEL[m]}
        </button>
      ))}
    </div>
  );
}
function GameCard({
  emoji, title, subtitle, description, status, onPlay,
}: {
  emoji: string;
  title: string;
  subtitle: string;
  description: string;
  status: GameStatus;
  onPlay: () => void;
}) {
  return (
    <div className="flex flex-col rounded-3xl border border-chalk/10 bg-night-2 p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-2xl leading-none">{emoji}</div>
          <h2 className="mt-2 font-display text-2xl font-black tracking-tight">{title}</h2>
          <div dir="ltr" className="mt-0.5 text-end text-xs font-bold text-chalk-dim">{subtitle}</div>
        </div>
        <GameStatusBadge status={status} />
      </div>
      <p className="mt-3 flex-1 text-sm text-chalk-2">{description}</p>
      <button
        onClick={onPlay}
        className="tap mt-4 h-12 w-full rounded-full bg-toto font-poster text-lg text-night
                   transition-transform duration-200 ease-brand active:scale-[.98]"
      >
        {STATUS_ACTION[status]}
      </button>
    </div>
  );
}

/* ================================================================== */

function DemoBanner({ message, size }: { message: string; size: number }) {
  return (
    <div
      role="status"
      className="mx-3 mt-3 rounded-2xl border border-armband/30 bg-armband/10 px-4 py-3"
    >
      <div className="flex items-center gap-2 text-sm font-black text-armband">
        <span aria-hidden>▲</span> מצב הדגמה
      </div>
      <p className="mt-1 text-[13px] leading-snug text-chalk-2">
        {message} עד שיעלו הסגלים החסרים, ההרכב מוקטן ל-
        <span className="num">{size}</span> שחקנים — הכלל של שחקן אחד מכל קבוצה
        נשמר במלואו.
      </p>
    </div>
  );
}

/* ================================================================== */
/* שמירת הרכב: שם תצוגה + קוד קסם, בדיוק כמו במשחק ה-5x5 המקורי         */
/* ================================================================== */

function SaveEntryModal({
  lineup, mode, userId, priceById, onSaved, onCancel,
}: {
  lineup: Parameters<typeof saveEntry>[4];
  mode: Mode;
  userId: string;
  /** להקפאת השווי ברגע ההגשה (§10). */
  priceById: Map<string, number>;
  onSaved: (entry: LineupEntry) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(() => {
    try { return localStorage.getItem('dubid.displayname.v1') ?? ''; } catch { return ''; }
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-night/80 px-6 backdrop-blur-sm">
      <form
        className="w-full max-w-xs rounded-2xl border border-chalk/10 bg-night-2 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          try { localStorage.setItem('dubid.displayname.v1', name.trim()); } catch { /* ignore */ }
          const saved = saveEntry(name, GAMEWEEK.id, mode, userId, lineup, priceById);
          onSaved(saved);
        }}
      >
        <div className="mx-auto mb-3 h-1 w-12 rounded-full bg-toto" />
        <h2 className="text-center font-display text-lg font-black">כמעט סיימנו</h2>
        <p className="mt-1 text-center text-xs text-chalk-dim">
          בחרו שם תצוגה לדירוג ({MODE_LABEL[mode]}). לאחר ההגשה ההרכב
          ננעל למחזור — עריכה נוספת תדרוש ביטול הגשה מפורש.
        </p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="השם שלכם בדירוג"
          className="mt-5 w-full rounded-xl border border-chalk/20 bg-night px-3 py-2.5 text-center
                     text-chalk outline-none focus:border-toto"
        />
        <button
          type="submit"
          disabled={!name.trim()}
          className="tap mt-4 w-full rounded-full bg-toto py-2.5 font-poster text-night disabled:opacity-40"
        >
          שמירת ההרכב
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="mt-3 w-full text-center text-xs text-chalk-dim underline underline-offset-2"
        >
          חזרה לעריכה
        </button>
      </form>
    </div>
  );
}

/* ================================================================== */

function CardScreen({
  lineup, pool, teams, rules, ready, entry,
}: {
  lineup: ReturnType<typeof useLineup>['lineup'];
  pool: PoolPlayer[];
  teams: TeamMeta[];
  rules: ReturnType<typeof resolveRules>['rules'];
  ready: boolean;
  entry: LineupEntry | undefined;
}) {
  const [showDemo, setShowDemo] = useState(false);
  const results = getResults(GAMEWEEK.id);
  const hasRealResults = results.published && Object.keys(results.performances).length > 0;

  const data: ShareCardData | null = useMemo(() => {
    if (!ready) return null;
    if (!hasRealResults && !showDemo) return null;

    const { performances, outcomes } = hasRealResults
      ? { performances: results.performances, outcomes: results.outcomes }
      : demoGameweek(lineup);
    const score = scoreLineup(lineup, performances, outcomes, rules, { validate: false });

    const teamById = new Map(teams.map((t) => [t.id, t]));
    const poolById = new Map(pool.map((p) => [p.id, p]));

    let rank = 0;
    let totalPlayers = 0;
    if (hasRealResults && entry) {
      const others = listEntries(GAMEWEEK.id, entry.mode);
      const pairs = others.flatMap((e) => {
        try {
          return [{ id: e.id, score: scoreLineup(e.lineup, results.performances, results.outcomes, rules, { validate: false }) }];
        } catch {
          return [];
        }
      });
      const idByScore = new Map(pairs.map((p) => [p.score, p.id]));
      const ranked = rankGameweek(pairs.map((p) => p.score));
      totalPlayers = ranked.length;
      const mine = ranked.find((r) => idByScore.get(r.score) === entry.id);
      rank = mine?.rank ?? 0;
    }

    return {
      gameweekLabel: GAMEWEEK.label,
      leagueLabel: LEAGUE.nameHe,
      userName: entry?.displayName ?? 'האורח',
      totalPoints: score.totalPoints,
      rank,
      totalPlayers,
      breakdown: {
        personal: score.personalPoints,
        result: score.resultPoints,
        captain: score.captainPoints,
        virtual: score.virtualPoints,
      },
      url: `${SITE_URL}/`,
      urlLabel: 'DUBID.DUBELTEAM.COM',
      lineup: score.players.map((p) => ({
        name: poolById.get(p.playerId)?.nameShort ?? p.playerId,
        teamShort: teamById.get(p.teamId)?.short ?? '',
        position: p.position,
        points: p.subtotal,
        isCaptain: p.isCaptain,
      })),
    };
  }, [ready, showDemo, hasRealResults, results, lineup, pool, teams, rules, entry]);

  if (data) return <ShareCard data={data} />;

  return (
    <div className="grid h-full place-items-center px-6 text-center">
      <div className="max-w-sm">
        <div className="mx-auto mb-4 h-1 w-16 rounded-full bg-toto" />
        <h2 className="font-display text-2xl font-black">עוד אין תוצאות למחזור</h2>
        <p className="mt-2 text-sm text-chalk-dim">
          {ready
            ? 'הכרטיס ייווצר אוטומטית ברגע שהמחזור ייסגר והניקוד יחושב.'
            : 'קודם השלימו את ההרכב — הכרטיס נבנה ממנו.'}
        </p>
        {ready && (
          <button
            onClick={() => setShowDemo(true)}
            className="tap mt-6 rounded-full bg-toto px-6 font-poster text-lg text-night
                       transition-transform duration-200 ease-brand active:scale-[.98]"
          >
            הצג כרטיס לדוגמה
          </button>
        )}
        <p className="mt-3 text-[11px] text-chalk-dim">
          כרטיס לדוגמה מייצר תוצאות מחזור מומצאות כדי להראות איך זה נראה.
        </p>
      </div>
    </div>
  );
}

/**
 * מחולל מחזור לדוגמה. **הנתונים כאן מומצאים** ומשמשים רק לתצוגה
 * מקדימה של הכרטיס לפני שיש נתוני אמת מהאדמין. דטרמיניסטי לפי מזהה
 * השחקן, כדי שאותו הרכב ייתן תמיד את אותו כרטיס.
 */
function demoGameweek(lineup: ReturnType<typeof useLineup>['lineup']) {
  const hash = (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  };

  const performances = new Map<string, PlayerPerformance>();
  const outcomes = new Map<string, TeamOutcome>();

  for (const slot of lineup.slots) {
    if (!slot.playerId) continue;
    const h = hash(slot.playerId);
    const goals = h % 7 === 0 ? 2 : h % 3 === 0 ? 1 : 0;
    const played = h % 11 !== 0;

    performances.set(slot.playerId, {
      playerId: slot.playerId,
      teamId: slot.teamId,
      position: slot.position,
      minutes: played ? 90 : 0,
      goals: played ? goals : 0,
      assists: played && h % 5 === 0 ? 1 : 0,
      ownGoals: 0,
      yellowCards: h % 8 === 0 ? 1 : 0,
      redCards: 0,
      saves: 0,
      penaltiesSaved: 0,
      penaltiesMissed: 0,
      goalsConceded: 0,
      cleanSheet: played && h % 4 === 0,
      played,
    });

    const tg = hash(slot.teamId);
    const result = tg % 3 === 0 ? 'W' : tg % 3 === 1 ? 'D' : 'L';
    outcomes.set(slot.teamId, {
      teamId: slot.teamId,
      result,
      goalsFor: result === 'W' ? 2 + (tg % 2) : result === 'D' ? 1 : 0,
      goalsAgainst: result === 'L' ? 1 + (tg % 2) : result === 'D' ? 1 : 0,
    });
  }

  return { performances, outcomes };
}

/* ================================================================== */

function RulesScreen() {
  const rows: Array<[string, string]> = [
    ['שער — שוער / מגן', '6'],
    ['שער — קשר', '5'],
    ['שער — חלוץ', '4'],
    ['בישול', '3'],
    ['שער נקי (60 דקות ומעלה)', '4'],
    ['כרטיס צהוב', '-1'],
    ['כרטיס אדום', '-3'],
    ['ניצחון של הקבוצה האמיתית', '+4'],
    ['תיקו של הקבוצה האמיתית', '+1'],
    ['כל 2 שערים של קבוצות ההרכב', '+5'],
  ];

  return (
    <div className="mx-auto max-w-2xl px-4 py-5">
      <section className="rounded-2xl border border-toto/30 bg-toto/10 p-4">
        <h2 className="font-display text-xl font-black text-toto">הכלל היחיד שחשוב</h2>
        <p className="mt-1 text-sm text-chalk-2">
          שחקן אחד מכל קבוצה. אי אפשר לקחת שניים מאותה קבוצה, גם לא ליום אחד.
        </p>
      </section>

      <h2 className="mt-6 font-display text-lg font-black">טבלת הניקוד</h2>
      <table className="mt-2 w-full text-sm">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-b border-chalk/10">
              <td className="py-2.5 text-start">{label}</td>
              <td className="num py-2.5 text-end text-toto">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mt-6 font-display text-lg font-black">הקפטן הדובידי</h2>
      <ul className="mt-2 space-y-2 text-sm text-chalk-2">
        <li>
          <b className="text-armband">×3</b> — הציון של הקפטן מוכפל פי שלוש,
          כולל בונוס התוצאה של הקבוצה שלו.
        </li>
        <li>
          <b className="text-armband">חסינות</b> — כרטיס צהוב של הקפטן מבוטל,
          אם שיחק 60 דקות ומעלה והקבוצה שלו לא הפסידה. אדום לא נסלח.
        </li>
        <li>
          <b className="text-armband">סגן</b> — אם הקפטן לא ירד למגרש,
          הכפולה עוברת אוטומטית לסגן.
        </li>
        <li>ציון שלילי לא מוכפל. ההימור מגדיל רווח, לא הפסד.</li>
      </ul>
    </div>
  );
}
