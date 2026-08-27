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
import { ensureIdentity, storedDisplayName, setDisplayName, subscribeToIdentity,
  type Identity } from './lib/identity.ts';

import { AppShell, AppHeader } from './components/AppShell.tsx';
import type { NavItem } from './components/BottomNav.tsx';
import { Lobby, type LobbyMode, type LobbyFixture } from './components/Lobby.tsx';
import { Arena } from './components/Arena.tsx';
import { DubelCredit } from './components/DubelCredit.tsx';
import { ShadesDivider } from './components/Shades.tsx';
import { usePromo } from './state/usePromo.ts';
import { DUBID_URL, type GrowthContext } from './lib/growth.ts';
import { OffsidesHero, OffsidesInline, OffsidesRail } from './components/OffsidesAds.tsx';
import { GameweekStatus, type Gameweek } from './lib/gameweek.ts';
import { serverNow } from './lib/serverTime.ts';
import { SquadPicker, type PoolPlayer, type TeamMeta } from './components/SquadPicker.tsx';
import { ShareCard } from './components/ShareCard.tsx';
import { Leaderboard } from './components/Leaderboard.tsx';
import { AdminPanel } from './components/AdminPanel.tsx';
import { AccountSheet } from './components/AccountSheet.tsx';
import { RegisterNudge, readDismissed } from './components/RegisterNudge.tsx';
import { shouldNudge } from './lib/nudge.ts';
import { LockedLineup } from './components/LockedLineup.tsx';
import { Splash } from './components/Splash.tsx';
import { RevealShare } from './components/RevealShare.tsx';
import type { RevealCardData } from './lib/revealCard.ts';
import { modeTheme } from './lib/modeTheme.ts';
import { GameStatusBadge } from './components/GameStatusBadge.tsx';
import { IconHome, IconLineup, IconArena, IconRanking, IconRules } from './components/NavIcons.tsx';

import { LEAGUE, TEAMS, PLAYERS, shortName, TEAM_BY_ID } from './data/squads.ts';
import {
  GAMEWEEK, GAMEWEEK_DEADLINE, FIRST_KICKOFF, OPPONENT_BY_TEAM,
  FIXTURES, kickoffTimeLabel,
} from './data/fixtures.ts';
import { resolveRules, DUBID_5X5, DUBID_5X5_BUDGET } from './lib/scoring/rules.ts';
import { scoreLineup, rankGameweek } from './lib/scoring/engine.ts';
import { buildLeaderboard } from './lib/leaderboard.ts';
import { checkLeagueCapacity, formatIssue } from './lib/scoring/validate.ts';
import { useLineup } from './state/useLineup.ts';
import { myLeagues } from './lib/leagueStore.ts';
import {
  getResults, saveEntry, listEntries, findMyEntry, deleteEntry, subscribeToStore,
  hydrate, startRealtime, storeStatus, errorMessageHe, getGameweekState,
  type LineupEntry,
} from './lib/store.ts';
import {
  hydrateLiveData, startLiveDataRealtime, subscribeToLiveData, liveDataVersion,
} from './lib/liveData.ts';
import { computeGameStatus, type GameStatus } from './lib/gameStatus.ts';
import type { PlayerPerformance, TeamOutcome } from './lib/scoring/types.ts';
import type { RuleSet } from './lib/scoring/rules.ts';
import type { ShareCardData } from './lib/shareCard.ts';

type Mode = 'full' | 'five';
const MODE_LABEL: Record<Mode, string> = { full: 'הרכב מלא · 11', five: '5 על 5' };

const SITE_URL = DUBID_URL;

/**
 * ★ חמישה פריטים, לא שישה.
 *
 * "הכרטיס" ירד מהניווט התחתון והפך ליעד: מגיעים אליו מהלובי
 * ומכפתור בהרכב הנעול, כלומר בדיוק ברגע שיש מה לראות בו. פריט
 * ניווט קבוע למסך שרוב הזמן ריק הוא בזבוז של אחת מחמש משבצות.
 *
 * במקומו נכנסה "הזירה" — פיצ׳ר שלם שהיה כתוב, בדוק, ובלי דרך
 * להגיע אליו.
 */
/** שם המסך בכותרת. מקור אחד, ולא מחרוזת מודבקת בכל ענף. */
const SCREEN_TITLE: Record<string, string> = {
  lineup: 'ההרכב',
  arena: 'הזירה',
  leaderboard: 'הדירוג',
  card: 'הכרטיס',
  rules: 'חוקי המשחק',
};

/**
 * ★ הסדר כאן הוא הסדר על המסך, וההרכב יושב באמצע בכוונה.
 *
 * `primary` מרים אותו לעיגול זהב שחורג מעל הפס. הפעולה שכל
 * המוצר משרת לא צריכה להיראות כמו אחת מחמש אפשרויות שוות.
 * ב-RTL הפריט הראשון במערך מופיע מימין; האמצעי נשאר באמצע
 * בשני הכיוונים, ולכן אין כאן תלות בשפה.
 */
const NAV: NavItem[] = [
  { id: 'home',        label: 'בית',    icon: <IconHome /> },
  { id: 'leaderboard', label: 'דירוג',  icon: <IconRanking /> },
  { id: 'lineup',      label: 'ההרכב',  icon: <IconLineup />, primary: true },
  { id: 'arena',       label: 'הזירה',  icon: <IconArena /> },
  { id: 'rules',       label: 'חוקים',  icon: <IconRules /> },
];

/**
 * ★ הניתוב לניהול — שתי כתובות, ובכוונה.
 *
 *     dubid.dubelteam.com/admin      ← זו שכותבים
 *     dubid.dubelteam.com/#admin     ← זו שהייתה, וממשיכה לעבוד
 *
 * הראשונה קלה לזכור ולהקליד בטלפון. השנייה נשארת כי היא כבר
 * שמורה במקומות, ושבירת כתובת קיימת היא עבודה מיותרת.
 *
 * `vercel.json` כבר מפנה כל נתיב ל-`index.html`, ולכן `/admin`
 * מגיע לאפליקציה ולא ל-404. **בלי rewrite כזה, הנתיב ישבר
 * בייצור אבל יעבוד בפיתוח** — הסוג הגרוע ביותר של תקלה.
 */
function useAdminRoute(): boolean {
  const [isAdmin, setIsAdmin] = useState(() => matchAdmin());
  useEffect(() => {
    const onChange = () => setIsAdmin(matchAdmin());
    window.addEventListener('hashchange', onChange);
    window.addEventListener('popstate', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
      window.removeEventListener('popstate', onChange);
    };
  }, []);
  return isAdmin;
}

function matchAdmin(): boolean {
  try {
    const path = window.location.pathname.replace(/\/+$/, '').toLowerCase();
    return window.location.hash === '#admin' || path === '/admin';
  } catch {
    return false;
  }
}

export function App() {
  const admin = useAdminRoute();
  if (admin) {
    return (
      <AdminPanel
        onExit={() => {
          // יוצאים משתי הכתובות גם יחד, אחרת חזרה לאפליקציה
          // מהנתיב `/admin` הייתה משאירה את המסך פתוח.
          window.location.hash = '';
          if (window.location.pathname.toLowerCase().startsWith('/admin')) {
            window.history.replaceState(null, '', '/');
          }
          window.dispatchEvent(new Event('popstate'));
        }}
      />
    );
  }
  return <MainApp />;
}

function MainApp() {
  const [tab, setTab] = useState('home');
  const [mode, setMode] = useState<Mode>('full');
  const [, tick] = useState(0);
  useEffect(() => subscribeToStore(() => tick((n) => n + 1)), []);

  /**
   * ★ העלייה: זהות → נתונים → זמן אמת. בסדר הזה.
   *
   * הזהות ראשונה כי `entries` מחזירה לפני הנעילה רק את ההגשה של
   * הקורא — בלי סשן, המשתמש לא רואה את ההרכב של עצמו.
   * `startRealtime` אחרון כי אין טעם להאזין לשינויים לפני שיש
   * תמונה להשוות אליה.
   */
  /**
   * ★ מסך הפתיחה יורד כשהנתונים מוכנים — לא לפי טיימר.
   *
   * `booted` נדלק אחרי שהזהות והליגה הגיעו. `Splash` מחזיק את
   * עצמו עד שגם הציור נגמר, ויש לו תקרה קשיחה משלו. כאן אנחנו
   * רק אומרים לו "אפשר".
   */
  const [booted, setBooted] = useState(false);
  const [splashGone, setSplashGone] = useState(false);

  useEffect(() => {
    const stops: Array<() => void> = [];
    void (async () => {
      await ensureIdentity();
      /* ★ הסגלים והלוח **לפני** ההגשות.
         `entries` מחזירה מזהי שחקנים; אם הסגל עדיין הזרע הסטטי,
         שחקן שהאדמין הוסיף היום מופיע כמזהה בלי שם. */
      await hydrateLiveData(GAMEWEEK.id);
      await hydrate(GAMEWEEK.id);
      setBooted(true);
      stops.push(startRealtime(GAMEWEEK.id));
      stops.push(startLiveDataRealtime(GAMEWEEK.id));
    })();
    return () => { for (const s of stops) s(); };
  }, []);

  /* דאטת הכדורגל השתנתה (האדמין ערך משהו) → רינדור מחדש. */
  const [liveVersion, setLiveVersion] = useState(0);
  useEffect(() => subscribeToLiveData(() => setLiveVersion(liveDataVersion())), []);

  /* ★ `liveVersion` בכל תלות שנגזרת מהסגל או מהלוח.
     בלעדיו: האדמין מוסיף שחקן, המערך מתעדכן, ו-`useMemo` עם
     `[]` ממשיך להחזיר את הרשימה מהרינדור הראשון — כלומר בדיוק
     הבאג שתוקן, רק שכבה אחת מעל. */
  const resolved = useMemo(() => resolveRules(TEAMS.length), [liveVersion]);
  const fullRules = resolved.rules;
  const fiveRules = DUBID_5X5;
  const rulesByMode: Record<Mode, RuleSet> = { full: fullRules, five: fiveRules };
  const capacityIssue = useMemo(
    () => checkLeagueCapacity(TEAMS.length, { ...fullRules, constraints: { ...fullRules.constraints, lineupSize: 11 } }),
    [fullRules],
  );

  const teams: TeamMeta[] = useMemo(
    () => TEAMS.map((t) => ({ id: t.id, short: t.short, name: t.nameHe })),
    [liveVersion],
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
    [liveVersion],
  );
  const priceById = useMemo(
    () => new Map(PLAYERS.map((p) => [p.id, p.price])), [liveVersion]);

  /** "נגד מי משחקים" — לתצוגה בגיליון בחירת השחקן, לפי מחזור נוכחי. */
  const opponentShortByTeam: Record<string, string> = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of TEAMS) {
      const opp = OPPONENT_BY_TEAM[t.id];
      if (opp) map[t.id] = TEAM_BY_ID.get(opp.opponentId)?.short ?? '';
    }
    return map;
  }, [liveVersion]);

  /**
   * ★ מי אני.
   *
   * קודם זה היה מזהה אקראי ב-`localStorage` — כלומר זהות של
   * דפדפן, לא של אדם. אותו משתמש בטלפון ובמחשב היה שני מתחרים,
   * וניקוי דפדפן היה מוחק אדם.
   *
   * עכשיו זה מזהה ה-auth של Supabase (אנונימי, בלי הרשמה),
   * ואין ברירת מחדל מקומית: עד שהוא מגיע המחרוזת ריקה, וכל מה
   * שנגזר ממנה (`isMe` בדירוג, ההגשה שלי) פשוט עוד לא ידוע.
   *
   * ★ מזהה מומצא היה גרוע יותר מאשר כלום: הוא היה גורם למסך
   *   לומר "זו ההגשה שלך" על שורה של מישהו אחר.
   */
  const [userId, setUserId] = useState('');
  useEffect(() => { void ensureIdentity().then((id) => setUserId(id.id)); }, []);

  /** הזהות המלאה — לצורך ההצעה להירשם. `null` עד שהיא נטענת. */
  const [identity, setIdentity] = useState<Identity | null>(null);
  useEffect(() => subscribeToIdentity(setIdentity), []);

  // שני הרכבים חיים תמיד, במקביל — לא נוצרים/נהרסים עם מעבר טאב,
  // כדי שהעבודה על אחד לא תימחק כשעוברים לשני ואז חוזרים.
  const luFull = useLineup(fullRules.constraints.formationAllowed[0], fullRules, {
    lineupId: 'draft-full', userId, gameweekId: GAMEWEEK.id, mode: 'full',
  });
  const luFive = useLineup(fiveRules.constraints.formationAllowed[0], fiveRules, {
    lineupId: 'draft-5x5', userId, gameweekId: GAMEWEEK.id, mode: 'five',
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

  const displayName = storedDisplayName() || undefined;

  const results = getResults(GAMEWEEK.id);

  /**
   * ★ מחזור הדגמה עד שהמסד מחובר.
   *   הדדליין נגזר מ-`GAMEWEEK` הקיים; אין כאן מקור אמת שני.
   *   ברגע שהמחזורים מגיעים מ-Supabase, השורה הזו מתחלפת בשאילתה
   *   והלובי לא משתנה בכלל — הוא כבר מקבל `Gameweek` מלא.
   */
  /**
   * ★ הדדליין מגיע מהשרת, לא מהמכשיר.
   *
   * `getGameweekState()` היא `game.gameweek_state('gw-2')` —
   * אותה שורה שאוכפת את הנעילה ב-`submit_entry`. כל עוד הלובי
   * חישב דדליין בעצמו, היה אפשר שהמסך יראה "פתוח" בזמן שהשרת
   * כבר דוחה — והמשתמש לוחץ "הגש" ומקבל שגיאה בלי להבין למה.
   *
   * `GAMEWEEK_DEADLINE` נשאר כגיבוי לפריים הראשון, ומאז המעבר
   * הוא גם עצמו מתעדכן מ-`game.fixtures()`.
   *
   * ★ הסטטוס נלקח מהשרת כשהוא נחרץ (`locked`/`live`/`settled`),
   *   כי אדמין יכול לנעול מוקדם — ושעון שאומר "עוד 3 שעות" מול
   *   מחזור נעול הוא בדיוק המסך שגורם לאנשים לחשוב שהמוצר שבור.
   */
  const gwState = getGameweekState();

  const lobbyGameweek: Gameweek = useMemo(() => {
    const deadlineAt = gwState?.lockAt ?? GAMEWEEK_DEADLINE;
    const serverLocked = gwState
      ? ['locked', 'live', 'settled'].includes(gwState.status)
      : false;
    return {
      id: GAMEWEEK.id,
      number: gwState?.number ?? GAMEWEEK.number ?? 1,
      label: GAMEWEEK.label,
      status: results.published
        ? GameweekStatus.Published
        : !serverLocked && Date.parse(deadlineAt) > serverNow()
          ? GameweekStatus.Open
          : GameweekStatus.Locked,
      deadlineAt,
      firstKickoffAt: gwState?.firstKickoffAt ?? FIRST_KICKOFF,
    };
  }, [results.published, gwState, liveVersion]);

  // ★ מספר המשתתפים מגיע מהשרת (`gameweek_state.entrants`) ולא
  //   מאורך הרשימה: לפני הנעילה `entries` מחזירה רק את ההגשה של
  //   הקורא, ולכן הלובי היה מציג "1 משתתף" גם כשיש חמישים.
  const entrantCount = gwState?.entrants ?? listEntries(GAMEWEEK.id).length;

  /* ★ סדר ההצהרות כאן אינו סגנוני.
     `growthCtx` קורא את שתי ההגשות, ולכן הן חייבות להיות מוצהרות
     לפניו. קודם הן היו אחריו — ו-`const` ב-TDZ הפיל את הרינדור
     הראשון ב-ReferenceError, כלומר מסך לבן. אל תזיזו את הבלוק הזה
     מתחת ל-`growthCtx`. */
  const hasRealResults = results.published && Object.keys(results.performances).length > 0;

  // ★ שכבת ה"נעילה": יש הגשה רשמית או שאין. כל עוד אין, המסך עורך את
  // הטיוטה. ברגע שיש — SquadPicker לא מוצג יותר, LockedLineup כן.
  const entryFull = findMyEntry(GAMEWEEK.id, 'full', userId);
  const entryFive = findMyEntry(GAMEWEEK.id, 'five', userId);
  const entryByMode: Record<Mode, LineupEntry | undefined> = { full: entryFull, five: entryFive };


  /**
   * ★ ההקשר של תוכנית השיווק הצולבת.
   *
   * כל שדה כאן הוא עובדה שהמסך כבר מחזיק — אין מעקב חדש, אין
   * קריאה לשרת, ואין מזהה אישי. `lib/growth.ts` מחליט מזה מה
   * להציג, דטרמיניסטית.
   *
   * ה-`useMemo` חיוני: הלובי מרנדר כל שנייה בגלל השעון, ואובייקט
   * חדש בכל רינדור היה מפעיל את בחירת המסר מחדש בלי סוף.
   */
  const growthCtx: GrowthContext = useMemo(() => ({
    submissionOpen: lobbyGameweek.status === GameweekStatus.Open,
    hasSubmitted: !!entryFull || !!entryFive,
    resultsPublished: results.published,
    // הרגע שקובע הוא השריקה הראשונה, לא הדדליין. הם לא זהים:
    // הדדליין הוא פתיחת המשחק המוקדם ביותר, וזה בדיוק הרגע שבו
    // אופסיידס הופך לרלוונטי.
    msToKickoff: Date.parse(lobbyGameweek.firstKickoffAt ?? lobbyGameweek.deadlineAt)
                 - serverNow(),
    entrants: entrantCount,
  }), [lobbyGameweek.status, lobbyGameweek.firstKickoffAt,
       entryFull, entryFive, results.published, entrantCount]);

  const { promo, dismiss: dismissPromo, open: openPromo } =
    usePromo(growthCtx, lobbyGameweek.number);


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

  /**
   * ★ המדדים בפס העליון של הלובי.
   *
   * המקום מגיע מ-`buildLeaderboard` — אותו צינור בדיוק שמזין את
   * מסך הדירוג. זה לא חיסכון בקוד אלא נכונות: לובי שמחשב דירוג
   * בעצמו יראה, ביום שבו שובר שוויון יכריע, מספר אחר מהטבלה.
   *
   * מחושב רק כשיש תוצאות. לפני זה `undefined`, והלובי מציג מקף.
   */
  const myStanding = useMemo(() => {
    if (!hasRealResults) return { rank: undefined, points: undefined };
    let best: { rank: number; points: number } | undefined;
    for (const m of ['five', 'full'] as const) {
      const mine = entryByMode[m];
      if (!mine) continue;
      const rows = buildLeaderboard({
        entries: listEntries(GAMEWEEK.id, m),
        performances: results.performances,
        outcomes: results.outcomes,
        rules: rulesByMode[m],
        userId,
      });
      const row = rows.find((r) => r.isMe);
      if (!row) continue;
      // כשיש שתי הגשות מציגים את החזקה. הלובי הוא כרזה, לא דוח.
      if (!best || row.score.totalPoints > best.points) {
        best = { rank: row.rank, points: row.score.totalPoints };
      }
    }
    return { rank: best?.rank, points: best?.points };
  }, [hasRealResults, entryByMode, results, rulesByMode, userId]);

  /** לוח המשחקים כפי שהלובי צריך אותו — בלי לחשוף לו את מבנה הדאטה. */
  const lobbyFixtures: LobbyFixture[] = useMemo(
    () => FIXTURES.map((f) => ({
      id: f.id,
      homeTeamId: f.homeTeamId,
      awayTeamId: f.awayTeamId,
      homeShort: TEAM_BY_ID.get(f.homeTeamId)?.short ?? f.homeTeamId,
      awayShort: TEAM_BY_ID.get(f.awayTeamId)?.short ?? f.awayTeamId,
      dayLabel: f.dayLabel,
      timeLabel: kickoffTimeLabel(f.kickoff, f.timeConfirmed),
    })),
    [liveVersion],
  );

  const leagueCount = myLeagues(userId).length;

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

  /**
   * ★ מהגשה לכרטיס.
   *
   * הכרטיס מדבר בשמות ובקיצורים, לא במזהים. התרגום קורה כאן
   * ולא בתוך `revealCard.ts`, כי המחולל צריך להישאר טהור —
   * הוא מצייר, הוא לא יודע מה זה `P305`.
   */
  const buildReveal = (saved: LineupEntry): RevealCardData => {
    const t = modeTheme(saved.mode);
    const filled = saved.lineup.slots.filter((sl) => sl.playerId);

    return {
      mode: saved.mode,
      gameweekLabel: GAMEWEEK.label,
      leagueLabel: LEAGUE.nameHe,
      userName: saved.displayName || 'מאמן',
      lineup: filled.map((sl) => {
        const p = pool.find((x) => x.id === sl.playerId);
        return {
          name: p?.nameShort ?? sl.playerId,
          teamShort: TEAM_BY_ID.get(sl.teamId)?.short ?? '',
          position: sl.position,
          shirt: PLAYERS.find((x) => x.id === sl.playerId)?.shirt ?? null,
          isCaptain: !!sl.isCaptain,
        };
      }),
      formation: saved.mode === 'full' ? saved.lineup.formation : undefined,
      /* תקציב רק במצב שבו יש תקציב. "0M" בדוביד 11 הוא מספר
         שמסביר משהו שלא קיים. */
      spent: t.budget === null
        ? undefined
        : filled.reduce((sum, sl) => sum + (priceById.get(sl.playerId) ?? 0), 0),
      deadlineLabel: deadlineLabel(lobbyGameweek.deadlineAt),
      entrants: entrantCount || undefined,
      url: SITE_URL,
      urlLabel: 'DUBID.DUBELTEAM.COM',
    };
  };

  const [showSaveModal, setShowSaveModal] = useState(false);

  /**
   * ★ כרטיס ה"הנה ההרכב שלי" — מופיע פעם אחת, מיד אחרי ההגשה.
   *
   * `null` = לא מוצג. הוא לא נשמר בשום מקום ולא חוזר: מסך
   * שיתוף שרודף הורג את המוצר, לא את השיתוף.
   */
  const [reveal, setReveal] = useState<RevealCardData | null>(null);
  const [showAccount, setShowAccount] = useState(false);

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
        leagueCount={leagueCount}
        myRank={myStanding.rank}
        myPoints={myStanding.points}
        fixtures={lobbyFixtures}
        onPlay={goToMode}
        onLeagues={() => setTab('arena')}
        onLeaderboard={() => setTab('leaderboard')}
        onAccount={() => setShowAccount(true)}
        identity={identity}
        nudge={
          shouldNudge({
            isGuest: identity?.isGuest !== false,
            // ★ "יש מה לאבד" = הגשתי באחד משני המצבים.
            hasSubmitted: !!entryFive || !!entryFull,
            published: results.published,
            gameweekNumber: GAMEWEEK.number,
            dismissedForGameweek: readDismissed(),
          }) ? (
            <RegisterNudge
              gameweekNumber={GAMEWEEK.number}
              published={results.published}
              onOpen={() => setShowAccount(true)}
            />
          ) : undefined
        }
        promo={promo}
        gameweekNumber={lobbyGameweek.number}
        onDismissPromo={dismissPromo}
        onOpenPromo={openPromo}
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
            gameweekNumber={GAMEWEEK.number}
            submittedAt={entry.submittedAt}
            onUnlock={!results.published ? () => {
              if (window.confirm('לבטל את ההגשה ולחזור לעריכת ההרכב? ההגשה הנוכחית תימחק.')) {
                void deleteEntry(entry.id).catch((e: unknown) => {
                  window.alert(errorMessageHe(e instanceof Error ? e.message : 'NETWORK'));
                });
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
            onSaved={(saved) => {
              setShowSaveModal(false);
              /* ★ הכרטיס נבנה מההגשה שחזרה מהשרת, ולא מהטיוטה
                 שעל המסך. השרת הוא זה שקובע מה נשמר בפועל —
                 ואם הוא חתך משהו, הכרטיס צריך להראות את מה
                 שנשמר, לא את מה שביקשנו. */
              setReveal(buildReveal(saved));
            }}
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
    arena: (
      <Arena
        userId={userId}
        displayName={displayName ?? ''}
        rulesByMode={rulesByMode}
        origin={SITE_URL}
      />
    ),
    leaderboard: <Leaderboard rulesByMode={rulesByMode} userId={userId} />,
    rules: <RulesScreen />,
  };

  return (
    <>
    {/* ★ מסך הפתיחה מרונדר **מעל** האפליקציה, לא במקומה.
        כך העלייה של הלובי, טעינת הפונטים והתמונות קורות מתחתיו
        בזמן שהלוגו מצייר את עצמו — ומה שנחשף אחרי הדהייה כבר
        מוכן. מסך פתיחה שמעכב את הרינדור הוא מסך שמבזבז את הזמן
        שהוא אמור לכסות. */}
    {!splashGone && (
      <Splash
        ready={booted}
        onDone={() => setSplashGone(true)}
        seasonLabel={`${LEAGUE.nameHe} · ${LEAGUE.season}`}
      />
    )}
    <AppShell
      // רק מסך הבנייה מנהל גובה בעצמו. שאר המסכים נגללים כרגיל.
      // ★ שני המצבים של מסך ההרכב הם עמודה בגובה קבוע.
      // קודם `fill` היה דולק רק בבנייה, ולכן המסך הנעול נגלל —
      // וזה מה שדחף את המגרש מתחת לקפל אחרי ההגשה.
      fill={tab === 'lineup'}
      items={NAV}
      activeId={tab}
      onSelect={setTab}
      /*
       * ★ הכותרת מדברת על המסך שהמשתמש נמצא בו.
       *
       * קודם היא הציגה תמיד "דוביד שוויצר" ומונה שחקנים —
       * גם במסך החוקים, גם בזירה, גם בדירוג. מונה `3/11` מעל
       * טבלת זירה הוא רעש: הוא לא נכון לשום דבר שבמסך.
       *
       * בלובי אין כותרת בכלל. הלובי כבר מציג לוגו, שם ושעון,
       * ופס כותרת מעליו היה חוזר על אותו מידע פעמיים.
       */
      header={
        tab === 'home' ? undefined : (
          <AppHeader
            title={SCREEN_TITLE[tab] ?? 'דוביד'}
            subtitle={
              <span className="flex items-center gap-2">
                <span>{LEAGUE.nameHe} · {GAMEWEEK.label}</span>
                {(tab === 'lineup' || tab === 'card') && <GameStatusBadge status={status} />}
              </span>
            }
            right={
              // המונה רלוונטי רק כשבונים הרכב.
              tab === 'lineup' && !entry ? (
                <div className="text-end">
                  <div className="num text-2xl text-gold">
                    {lu.filled}/{rules.constraints.lineupSize}
                  </div>
                  <div className="text-[11px] text-chalk-dim">שחקנים</div>
                </div>
              ) : undefined
            }
          />
        )
      }
    >
      <ConnectionStrip />
      {screens[tab]}
      {showAccount && <AccountSheet onClose={() => setShowAccount(false)} />}
      {reveal && (
        <RevealShare
          data={reveal}
          onClose={() => { setReveal(null); setTab('card'); }}
        />
      )}
    </AppShell>
    </>
  );
}

/**
 * ★ הפס שמופיע רק כשמשהו לא בסדר — ואומר **מה** לא בסדר.
 *
 * הגרסה הראשונה כתבה "אין חיבור לשרת" בכל מקרה. זו ההודעה הכי
 * מתסכלת שאפשר לתת: היא נכונה תמיד ולא עוזרת אף פעם. ברוב
 * המקרים אין שום בעיית רשת — המיגרציה לא רצה, הסכימות לא
 * חשופות, או כניסת אורחים כבויה. שלוש בעיות, שלושה תיקונים,
 * ואותה הודעה חסרת תועלת.
 *
 * עכשיו `errorCode` מבדיל ביניהן (ראו `store.ts`), והפס מציג את
 * ההוראה עצמה. למי שזה לא רלוונטי — הפס פשוט לא מופיע.
 */
function ConnectionStrip() {
  const [, tick] = useState(0);
  useEffect(() => subscribeToStore(() => tick((n) => n + 1)), []);
  const { live, loading, error } = storeStatus();
  if (live || loading) return null;

  // ★ תקלת תשתית מוצגת כהוראה, לא כאזהרה אדומה.
  //   אדום אומר "משהו נשבר"; כאן משהו פשוט עוד לא הוגדר.
  const setup = error === 'MIGRATION_MISSING'
    || error === 'SCHEMA_NOT_EXPOSED'
    || error === 'ANON_DISABLED'
    || error === 'NO_PERMISSION'
    || error === 'BAD_KEY';

  return (
    <div
      role="status"
      className={`mx-3 mt-2 rounded-xl border px-3 py-2 text-[11.5px] font-bold ${
        setup
          ? 'border-armband/40 bg-armband/10 text-armband'
          : 'border-flare/35 bg-flare/10 text-flare'
      }`}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden>{setup ? '⚙' : '●'}</span>
        <span className="min-w-0 flex-1 leading-snug">
          {errorMessageHe(error ?? 'NETWORK')}
        </span>
        <button
          type="button"
          onClick={() => { void hydrate(GAMEWEEK.id, true); }}
          className="shrink-0 underline underline-offset-2"
        >
          נסו שוב
        </button>
      </div>
      {setup && (
        <div className="mt-1 ps-5 text-[10.5px] font-normal opacity-80">
          עד שזה מסודר, המשחק עובד מקומית — אבל בלי סנכרון בין מכשירים.
          {' '}
          <a href="#admin" className="underline underline-offset-2">בדיקת מערכת</a>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/* מתג מצב משחק — הרכב מלא / 5 על 5, אותה תשתית משני צדי המתג          */
/* ================================================================== */

function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    // shrink-0: המחליף הוא כרום ולא תוכן. בלי זה הוא מתחרה
    // עם המגרש על הגובה שנשאר.
    <div className="mx-3 mt-2 flex shrink-0 gap-1.5 rounded-full bg-night-2 p-1 edge-gold">
      {(['full', 'five'] as const).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`tap flex-1 rounded-full py-1.5 text-[13px] font-black transition-colors duration-200 ease-brand ${
            mode === m
              ? 'bg-gradient-to-b from-gold-light to-gold text-gold-ink'
              : 'text-chalk-dim'
          }`}
        >
          {MODE_LABEL[m]}
        </button>
      ))}
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
  const [name, setName] = useState(() => storedDisplayName());
  /**
   * ★ שלושה מצבים, ולא שניים.
   *
   * "שולח" חייב להיות מצב נפרד מ"מוכן": ההגשה עוברת עכשיו בשרת,
   * ומשתמש שלוחץ פעמיים בזמן שהבקשה באוויר שולח שתי הגשות. הכפתור
   * ננעל בזמן השליחה, וזו הסיבה היחידה שהוא ננעל.
   *
   * "שגיאה" חייב להיות נראה: השרת דוחה הגשה אחרי הדדליין, והמשתמש
   * צריך לדעת **למה** ההרכב לא נשמר — לא רק שהמסך לא זז.
   */
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-night/80 px-6 backdrop-blur-sm">
      <form
        className="w-full max-w-xs rounded-2xl border border-gold/15 bg-night-2 p-6 edge-gold"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || busy) return;
          setBusy(true);
          setError(null);
          void (async () => {
            try {
              await setDisplayName(name);
              const saved = await saveEntry(name, GAMEWEEK.id, mode, userId, lineup, priceById);
              onSaved(saved);
            } catch (err) {
              setError(errorMessageHe(err instanceof Error ? err.message : 'NETWORK'));
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <div className="mx-auto mb-3 h-1 w-12 rounded-full bg-gold" />
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
          disabled={busy}
          className="mt-5 w-full rounded-xl border border-gold/25 bg-night px-3 py-2.5 text-center
                     text-chalk outline-none focus:border-gold disabled:opacity-50"
        />

        {error && (
          <p role="alert" className="mt-3 rounded-xl border border-flare/40 bg-flare/10
                                     px-3 py-2 text-center text-[12px] font-bold text-flare">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!name.trim() || busy}
          className="tap mt-4 w-full rounded-full bg-gradient-to-b from-gold-light to-gold
                     py-2.5 font-poster text-gold-ink disabled:opacity-40"
        >
          {busy ? 'שולח לשרת…' : 'שמירת ההרכב'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="mt-3 w-full text-center text-xs text-chalk-dim underline underline-offset-2
                     disabled:opacity-40"
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

  if (data) {
    return (
      <div className="mx-auto max-w-lg px-4 pb-6">
        <ShareCard data={data} />

        {/* ═══════════ הרגע החזק ביותר בתוכנית ═══════════
            המשתמש בדיוק ראה כמה עשה. יש רגש טרי — ניצחון או
            הפסד, ושניהם עובדים — ואין לו שום משימה פתוחה. זה
            המסך היחיד שבו כרזה בגודל מלא היא המשך ולא הפרעה. */}
        <OffsidesHero
          className="mt-5"
          placement="card"
          gameweekNumber={GAMEWEEK.number}
          headline={data.rank === 1
            ? 'מקום ראשון. עכשיו בלי שבוע להתכונן.'
            : 'הריוונג׳ כאן הוא בעוד שבוע. שם — הערב.'}
          body="אותם משחקים, ניחושים חיים, זירות מול החברים שלכם."
        />

        <OffsidesInline
          placement="card"
          gameweekNumber={GAMEWEEK.number}
          className="mt-3 text-center"
        />
      </div>
    );
  }

  return (
    <div className="grid h-full place-items-center px-6 text-center">
      <div className="max-w-sm">
        <div className="mx-auto mb-4 h-1 w-16 rounded-full bg-gold" />
        <h2 className="font-display text-2xl font-black">עוד אין תוצאות למחזור</h2>
        <p className="mt-2 text-sm text-chalk-dim">
          {ready
            ? 'הכרטיס ייווצר אוטומטית ברגע שהמחזור ייסגר והניקוד יחושב.'
            : 'קודם השלימו את ההרכב — הכרטיס נבנה ממנו.'}
        </p>
        {ready && (
          <button
            onClick={() => setShowDemo(true)}
            className="tap mt-6 rounded-full bg-gold px-6 font-poster text-lg text-night
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
      <section className="rounded-2xl border border-gold/30 bg-gold/10 p-4">
        <h2 className="font-display text-xl font-black text-gold">הכלל היחיד שחשוב</h2>
        <p className="mt-1 text-sm text-chalk-2">
          שחקן אחד מכל קבוצה. אי אפשר לקחת שניים מאותה קבוצה, גם לא ליום אחד.
        </p>
      </section>

      <h2 className="mt-6 font-display text-lg font-black">טבלת הניקוד</h2>
      <table className="mt-2 w-full text-sm">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-b border-gold/15">
              <td className="py-2.5 text-start">{label}</td>
              <td className="num py-2.5 text-end text-gold">{value}</td>
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

      {/*
        ★ שוברי השוויון היו חסרים מהמסך הזה.

        המנוע מכריע לפי היררכיה בת שמונה רמות, והדירוג אפילו
        *אומר* מה שבר את השוויון — אבל שום מקום במוצר לא הסביר
        מה ההיררכיה. הברִיף דורש שהניקוד יהיה "ניתן להסבר
        למשתמשים", ומשתמש שרואה "הוכרע לפי הקפטן" בלי לדעת מה
        זה אומר, חושב שהמערכת המציאה משהו.
      */}
      <h2 className="mt-6 font-display text-lg font-black">מה קורה בשוויון</h2>
      <p className="mt-1 text-sm text-chalk-2">
        לעולם לא הגרלה. יורדים ברשימה עד שנמצא הבדל:
      </p>
      <ol className="mt-2 space-y-1.5 text-sm text-chalk-2">
        {[
          'ניקוד כולל',
          'ניקוד הקפטן',
          'תרומת הבחירות הנדירות',
          'שערים של השחקנים שנבחרו',
          'בישולים של השחקנים שנבחרו',
          'שערים נקיים',
          'שאר התרומה המאומתת',
          'זמן ההגשה הרשמי — מי שהגיש קודם',
        ].map((label, i) => (
          <li key={label} className="flex gap-2.5">
            <span className="num shrink-0 text-chalk-dim">{i + 1}.</span>
            <span>{label}</span>
          </li>
        ))}
      </ol>

      <h2 className="mt-6 font-display text-lg font-black">בחירה נדירה</h2>
      <p className="mt-1 text-sm text-chalk-2">
        שחקן שמעטים בחרו ושהביא נקודות שווה יותר. הבונוס עובד רק אם
        השחקן באמת הופיע בגיליון — בחירה נדירה שלא שיחקה לא מזכה בכלום,
        אחרת היה משתלם לבחור שחקנים שלא במשחק. הבונוס כבוי כשיש פחות
        מ-<span className="num">20</span> משתתפים, כי אז "נדיר" לא אומר כלום.
      </p>

      <ShadesDivider className="my-7 px-8" />

      {/* ★ שורת טקסט ולא באנר.
          מסך החוקים הוא הרגע הקר ביותר במוצר — המשתמש קורא, הוא
          לא מחליט כלום, ואין לו רגש. באנר כאן היה מוקפץ; משפט
          שממשיך את מה שהוא כבר קורא הוא פשוט מידע נוסף. */}
      <OffsidesInline placement="rules" gameweekNumber={GAMEWEEK.number} className="px-1" />

      <OffsidesRail placement="rules" gameweekNumber={GAMEWEEK.number} className="mt-4" />

      <ShadesDivider className="my-7 px-8" />

      <DubelCredit variant="card" />
    </div>
  );
}

/**
 * "שבת 20:00" — לכרטיס השיתוף.
 *
 * ★ אזור הזמן ננעל על ישראל, כמו בכל מקום אחר במוצר.
 *   כרטיס שנוצר בטלפון שמוגדר לאזור זמן אחר היה מודיע לחברים
 *   של המשתמש על שעת נעילה שגויה — והם היו מפספסים את המחזור.
 */
function deadlineLabel(iso: string): string {
  try {
    const d = new Date(iso);
    const day = d.toLocaleDateString('he-IL', {
      weekday: 'long', timeZone: 'Asia/Jerusalem',
    }).replace(/^יום\s+/, '');
    const time = d.toLocaleTimeString('he-IL', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem',
    });
    return `${day} ${time}`;
  } catch {
    return '';
  }
}
