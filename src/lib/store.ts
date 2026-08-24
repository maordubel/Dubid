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
  /** מזהה מכשיר/משתמש מקומי — כדי שנוכל לשחזר "זו ההגשה שלי" אחרי רענון. */
  userId: string;
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

/**
 * ★ ההגשה הרשמית של המשתמש הזה, למצב ולמחזור הזה — אם קיימת.
 * זה מה שהופך "טיוטה" ל"הרכב נעול": ברגע שיש הגשה, מסך ההרכב
 * מפסיק להיות בר-עריכה ומציג את הלוח הנעול במקום ה-SquadPicker.
 */
export function findMyEntry(gameweekId: string, mode: 'full' | 'five', userId: string): LineupEntry | undefined {
  return listEntries(gameweekId, mode).find((e) => e.userId === userId);
}

export function saveEntry(
  displayName: string,
  gameweekId: string,
  mode: 'full' | 'five',
  userId: string,
  lineup: Lineup,
  /**
   * ★ שווי לכל שחקן, לצורך הקפאת ה-snapshot (§10).
   * מגיע מהקורא כי `store` לא מכיר את קטלוג השחקנים — וגם לא צריך.
   */
  priceById?: Map<string, number> | Record<string, number>,
): LineupEntry {
  const all = read<LineupEntry[]>(KEYS.entries, []);

  // ★ ההגשה מקפיאה את המחיר. מרגע זה ההרכב הוא מסמך היסטורי:
  //   שינוי מחיר בקטלוג לא נוגע בו יותר.
  const prices = priceById instanceof Map ? priceById : new Map(Object.entries(priceById ?? {}));
  const frozen: Lineup = {
    ...lineup,
    slots: lineup.slots.map((s) => ({
      ...s,
      price: s.price ?? (s.playerId ? prices.get(s.playerId) : undefined),
    })),
  };

  const entry: LineupEntry = {
    id: `entry-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    magicCode: makeMagicCode(),
    displayName: displayName.trim() || 'אלמוני',
    gameweekId,
    mode,
    userId,
    lineup: frozen,
    submittedAt: new Date().toISOString(),
  };
  write(KEYS.entries, [...all, entry]);
  return entry;
}

/**
 * ביטול הגשה — "פותח נעילה" וחוזר לטיוטה. מותר רק כל עוד תוצאות
 * המחזור לא פורסמו (נאכף ב-UI, ב-`App.tsx`, לא כאן).
 */
export function deleteEntry(entryId: string) {
  const all = read<LineupEntry[]>(KEYS.entries, []);
  write(KEYS.entries, all.filter((e) => e.id !== entryId));
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
/* מפגש ניהול                                                          */
/* ------------------------------------------------------------------ */

/**
 * ★★ אזהרת אבטחה — לקרוא לפני שנוגעים ★★
 *
 * עד לפני השינוי הזה הסיסמה הייתה כתובה כאן כמחרוזת גלויה. כל אחד
 * שפתח את ה-bundle בדפדפן ראה אותה. הברִיף אוסר את זה פעמיים
 * (סעיף 11 ו-33), ובצדק — זה חסם production.
 *
 * מה תוקן כאן: הסיסמה עצמה כבר לא נמצאת בקוד. נשמר רק hash שלה,
 * וההשוואה נעשית מול ה-hash. בנוסף נוסף חסם ניסיונות.
 *
 * מה **לא** תוקן, ואי אפשר לתקן בצד לקוח:
 *   · hash בדפדפן הוא לא אימות. מי שמריץ את הקוד יכול לדלג עליו.
 *   · אין סשן חתום, אין revocation אמיתי, אין הרשאות.
 *
 * ⚠ לפני עלייה לאוויר: להעביר את בדיקת ההרשאה ל-Supabase
 *   (Edge Function + RLS), ולהשאיר כאן רק את ה-UI. המסך הזה הוא
 *   נוחות, לא שכבת אבטחה — ואסור להתייחס אליו ככזו.
 */

/** SHA-256 של סיסמת הניהול. הסיסמה עצמה לא מופיעה בקוד. */
const ADMIN_PIN_HASH =
  '15a4edaa167df3c9656a9d3dacb527f795dfd2007bc2e0247a27eaeefc8343bf';

/** הגנה מפני ניחוש בכוח גס. נשמר לסשן בלבד. */
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;
const ATTEMPTS_KEY = 'dubid.admin.attempts.v1';

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readAttempts(): { count: number; until: number } {
  try {
    return JSON.parse(sessionStorage.getItem(ATTEMPTS_KEY) ?? '') as { count: number; until: number };
  } catch {
    return { count: 0, until: 0 };
  }
}

function writeAttempts(v: { count: number; until: number }) {
  try {
    sessionStorage.setItem(ATTEMPTS_KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

/** כמה שניות נותרו לנעילה. 0 = לא נעול. */
export function adminLockoutSeconds(): number {
  const { until } = readAttempts();
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

/**
 * אסינכרוני — `crypto.subtle` מחזיר Promise. הקורא חייב לחכות.
 * זו הסיבה היחידה שהחתימה השתנתה.
 */
export async function tryAdminLogin(pin: string): Promise<boolean> {
  if (adminLockoutSeconds() > 0) return false;

  const ok = (await sha256Hex(pin.trim())) === ADMIN_PIN_HASH;

  if (ok) {
    writeAttempts({ count: 0, until: 0 });
    try {
      sessionStorage.setItem(KEYS.adminSession, '1');
    } catch {
      /* ignore */
    }
    return true;
  }

  const prev = readAttempts();
  const count = prev.count + 1;
  writeAttempts({
    count: count >= MAX_ATTEMPTS ? 0 : count,
    until: count >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : 0,
  });
  return false;
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
