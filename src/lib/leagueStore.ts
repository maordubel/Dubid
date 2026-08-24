/**
 * lib/leagueStore.ts — שמירת הזירות.
 *
 * ★ למה קובץ נפרד מ-`store.ts`
 *
 * `store.ts` מחזיק הרכבים ותוצאות — דברים שיעברו לשרת יחד. הזירות
 * הן יחידה עצמאית עם מיגרציה משלה (`db/06_private_leagues.sql`,
 * שכבר קיימת עם `game.create_league` ו-`game.join_league`).
 *
 * ההפרדה הזו היא מה שיאפשר להחליף **רק** את הקובץ הזה בקריאות
 * RPC, בלי לגעת במסך ובלי לגעת בשאר האחסון. החתימות כאן נבחרו
 * בכוונה כך שיתאימו אחת לאחת לפונקציות שכבר קיימות במסד.
 *
 * ★ מה כאן *לא* מוכרע
 *
 * הדירוג. הוא נעשה ב-`leagues.standings()`, שעובר דרך
 * `rankEntries` — אותה היררכיית שוברי שוויון של הדירוג הראשי.
 * אחסון לא מדרג. אף פעם.
 */
import {
  canJoin, isValidCode, makeInviteCode, normalizeCode,
  type JoinResult, type LeagueMember, type PrivateLeague,
} from './leagues.ts';
import { JoinError } from './leagues.ts';
import type { ModeId } from './events/bus.ts';

const KEYS = {
  leagues: 'dubid.leagues.v1',
  members: 'dubid.league_members.v1',
} as const;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    // אותו אירוע של `store.ts` — מסך אחד משתנה, כולם מתרעננים.
    window.dispatchEvent(new Event('dubid:store'));
  } catch {
    /* גלישה פרטית — לא מפילים את המסך */
  }
}

export function listLeagues(): PrivateLeague[] {
  return read<PrivateLeague[]>(KEYS.leagues, []);
}

export function listMembers(leagueId?: string): LeagueMember[] {
  const all = read<LeagueMember[]>(KEYS.members, []);
  return leagueId ? all.filter((m) => m.leagueId === leagueId) : all;
}

/** הזירות שהמשתמש חבר בהן. */
export function myLeagues(userId: string): PrivateLeague[] {
  const mine = new Set(listMembers().filter((m) => m.userId === userId).map((m) => m.leagueId));
  return listLeagues().filter((l) => mine.has(l.id));
}

export function findByCode(code: string): PrivateLeague | undefined {
  const norm = normalizeCode(code);
  return listLeagues().find((l) => l.code === norm);
}

/**
 * יוצר זירה. המייסד מצורף מיד — זירה בלי מייסד היא מצב שאסור
 * שיתקיים, ולכן שתי הכתיבות קורות יחד.
 *
 * ★ הקוד נבדק מול הקיימים.
 *   שישה תווים מאלפבית של 31 נותנים כמעט מיליארד צירופים, אבל
 *   "כמעט" הוא לא "אף פעם". התנגשות שקטה הייתה שולחת משתמש
 *   לזירה של זרים.
 */
export function createLeague(input: {
  name: string;
  mode: ModeId;
  ownerId: string;
  ownerName: string;
  maxMembers?: number | null;
}): PrivateLeague {
  const existing = new Set(listLeagues().map((l) => l.code));
  let code = makeInviteCode();
  for (let i = 0; i < 20 && existing.has(code); i++) code = makeInviteCode();

  const league: PrivateLeague = {
    id: `lg_${code}_${Date.now().toString(36)}`,
    name: input.name.trim().slice(0, 40) || 'הזירה שלי',
    kind: 'arena',
    code,
    ownerId: input.ownerId,
    mode: input.mode,
    createdAt: new Date().toISOString(),
    status: 'active',
    maxMembers: input.maxMembers ?? null,
  };

  write(KEYS.leagues, [...listLeagues(), league]);
  write(KEYS.members, [...listMembers(), {
    leagueId: league.id,
    userId: input.ownerId,
    displayName: input.ownerName,
    joinedAt: league.createdAt,
  }]);

  return league;
}

/**
 * הצטרפות בקוד. הבדיקה עצמה היא `canJoin` הטהורה — כאן רק
 * מאתרים ומצרפים. אותה הפרדה בדיוק כמו במסד: הפונקציה מחליטה,
 * ה-RPC כותב.
 */
export function joinByCode(
  code: string,
  userId: string,
  displayName: string,
): JoinResult & { league?: PrivateLeague } {
  const norm = normalizeCode(code);
  if (!isValidCode(norm)) return { ok: false, error: JoinError.NotFound };

  const league = findByCode(norm);
  const members = league ? listMembers(league.id) : [];
  const verdict = canJoin(league, members, userId);
  if (!verdict.ok || !league) return verdict;

  write(KEYS.members, [...listMembers(), {
    leagueId: league.id,
    userId,
    displayName,
    joinedAt: new Date().toISOString(),
  }]);

  return { ok: true, league };
}

/** יציאה מזירה. המייסד לא יכול לצאת — אחרת נשארת זירה יתומה. */
export function leaveLeague(leagueId: string, userId: string): boolean {
  const league = listLeagues().find((l) => l.id === leagueId);
  if (!league || league.ownerId === userId) return false;
  write(KEYS.members, listMembers().filter(
    (m) => !(m.leagueId === leagueId && m.userId === userId),
  ));
  return true;
}
