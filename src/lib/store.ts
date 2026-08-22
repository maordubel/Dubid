/**
 * lib/store.ts — "מסד הנתונים" של הדמו.
 *
 * עד שמתחבר API כדורגל אמיתי + Supabase (החיווט כבר קיים ב-
 * integrations/), הפלטפורמה שלמה עובדת מול localStorage בדפדפן:
 *   · הרכבים שהוגשו (עם שם + סיסמת קסם, בדיוק כמו ב-5x5)
 *   · תוצאות המחזור שהאדמין מזין בלוח הניהול
 *
 * שני הצדדים (SquadPicker/Leaderboard מול AdminPanel) קוראים וכותבים
 * לאותם מפתחות, ולכן דירוג מתעדכן מיד אחרי שהאדמין שומר תוצאות —
 * בלי ריענון, בלי שרת. `dispatchEvent(new Event('dubid:store'))` בסוף
 * כל כתיבה מודיע לכל הקומפוננטות המאזינות לרענן את עצמן.
 */
import type { Lineup, PlayerPerformance, TeamOutcome } from './scoring/types.ts';

const KEYS = {
  entries: 'dubid.entries.v1',
  results: 'dubid.results.v1',
  adminSession: 'dubid.admin.session.v1',
} as const;

export interface LineupEntry {
  id: string;
  magicCode: string;
  displayName: string;
  gameweekId: string;
  /** באיזה פורמט הוגש ההרכב — כדי שהדירוג יציג כל מצב לחוד. */
  mode: 'full' | 'five';
  lineup: Lineup;
  submittedAt: string;
}

export interface FixtureScore {
  fixtureId: string;
  homeGoals: number;
  awayGoals: number;
  final: boolean;
}

export interface GameweekResults {
  gameweekId: string;
  performances: Record<string, PlayerPerformance>;
  outcomes: Record<string, TeamOutcome>;
  fixtureScores: Record<string, FixtureScore>;
  published: boolean;
  updatedAt: string;
}

function notify() {
  try {
    window.dispatchEvent(new Event('dubid:store'));
  } catch {
    /* SSR / לא בדפדפן */
  }
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    notify();
  } catch {
    /* מצב פרטי / חריגה ממכסה — לא שוברים את האפליקציה */
  }
}

/* ------------------------------------------------------------------ */
/* קודי קסם                                                            */
/* ------------------------------------------------------------------ */

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function makeMagicCode(): string {
  return (
    'DB-' +
    Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('')
  );
}

/* ------------------------------------------------------------------ */
/* הרכבים שהוגשו                                                       */
/* ------------------------------------------------------------------ */

export function listEntries(gameweekId?: string, mode?: 'full' | 'five'): LineupEntry[] {
  const all = read<LineupEntry[]>(KEYS.entries, []);
  return all.filter(
    (e) => (!gameweekId || e.gameweekId === gameweekId) && (!mode || e.mode === mode),
  );
}

export function saveEntry(
  displayName: string,
  gameweekId: string,
  mode: 'full' | 'five',
  lineup: Lineup,
): LineupEntry {
  const all = read<LineupEntry[]>(KEYS.entries, []);
  const entry: LineupEntry = {
    id: `entry-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    magicCode: makeMagicCode(),
    displayName: displayName.trim() || 'אלמוני',
    gameweekId,
    mode,
    lineup,
    submittedAt: new Date().toISOString(),
  };
  write(KEYS.entries, [...all, entry]);
  return entry;
}

export function findEntry(displayName: string, magicCode: string): LineupEntry | undefined {
  const all = read<LineupEntry[]>(KEYS.entries, []);
  const name = displayName.trim().toLowerCase();
  const code = magicCode.trim().toUpperCase();
  return all.find(
    (e) => e.displayName.trim().toLowerCase() === name && e.magicCode.toUpperCase() === code,
  );
}

/* ------------------------------------------------------------------ */
/* תוצאות מחזור (מוזנות ע"י האדמין)                                     */
/* ------------------------------------------------------------------ */

function emptyResults(gameweekId: string): GameweekResults {
  return {
    gameweekId,
    performances: {},
    outcomes: {},
    fixtureScores: {},
    published: false,
    updatedAt: new Date().toISOString(),
  };
}

export function getResults(gameweekId: string): GameweekResults {
  const all = read<Record<string, GameweekResults>>(KEYS.results, {});
  return all[gameweekId] ?? emptyResults(gameweekId);
}

export function saveResults(results: GameweekResults) {
  const all = read<Record<string, GameweekResults>>(KEYS.results, {});
  all[results.gameweekId] = { ...results, updatedAt: new Date().toISOString() };
  write(KEYS.results, all);
}

export function upsertPerformance(gameweekId: string, perf: PlayerPerformance) {
  const results = getResults(gameweekId);
  results.performances[perf.playerId] = perf;
  saveResults(results);
}

export function upsertFixtureScore(
  gameweekId: string,
  score: FixtureScore,
  outcomesForFixture: TeamOutcome[],
) {
  const results = getResults(gameweekId);
  results.fixtureScores[score.fixtureId] = score;
  for (const o of outcomesForFixture) {
    results.outcomes[o.teamId] = o;
  }
  saveResults(results);
}

export function setPublished(gameweekId: string, published: boolean) {
  const results = getResults(gameweekId);
  results.published = published;
  saveResults(results);
}

/* ------------------------------------------------------------------ */
/* מפגש ניהול — לא אבטחה אמיתית, רק חסם כניסה למסך למי שלא צריך אותו.   */
/* להחלפה ב-auth אמיתי (Supabase) לפני שהאתר נגיש לציבור הרחב.          */
/* ------------------------------------------------------------------ */

const ADMIN_PIN = 'hapoelTA14!';

export function tryAdminLogin(pin: string): boolean {
  const ok = pin.trim() === ADMIN_PIN;
  if (ok) {
    try {
      sessionStorage.setItem(KEYS.adminSession, '1');
    } catch {
      /* ignore */
    }
  }
  return ok;
}

export function isAdminSession(): boolean {
  try {
    return sessionStorage.getItem(KEYS.adminSession) === '1';
  } catch {
    return false;
  }
}

export function adminLogout() {
  try {
    sessionStorage.removeItem(KEYS.adminSession);
  } catch {
    /* ignore */
  }
}

/** הוק-עזר: מרענן קומפוננטה בכל פעם שהחנות משתנה (כולל מטאב אדמין אחר). */
export function subscribeToStore(cb: () => void): () => void {
  window.addEventListener('dubid:store', cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener('dubid:store', cb);
    window.removeEventListener('storage', cb);
  };
}
