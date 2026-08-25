/**
 * lib/leagueStore.ts — הזירות. עכשיו מהשרת.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ מה היה שבור, ולמה אף אחד לא ראה
 * ═══════════════════════════════════════════════════════════════
 *
 * `db/06_private_leagues.sql` יצר את הטבלאות ואת `create_league`
 * ו-`join_league`. הכל היה שם, מוכן, ועובד.
 *
 * והקובץ הזה כתב ל-`localStorage`.
 *
 * המשמעות המעשית: זירה שנפתחה בטלפון **לא קיימת** במחשב. שני
 * אנשים שהקלידו את אותו קוד הצטרפו לשתי זירות שונות — כל אחד
 * בדפדפן שלו, כל אחד עם טבלה של איש אחד. הכל נראה תקין בכל מכשיר
 * בנפרד, וזו הסיבה שזה שרד: **באג שנראה נכון בכל בדיקה של אדם
 * אחד, ונשבר רק כששניים משחקים.**
 *
 * זה בדיוק הבאג שתוקן להרכבים; הוא פשוט נשאר חי בטאב אחד.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ אותו דפוס כמו `store.ts`, ומאותה סיבה
 * ═══════════════════════════════════════════════════════════════
 *
 * הקריאות (`listLeagues`, `myLeagues`) נשארות **סינכרוניות** מעל
 * תמונת מצב בזיכרון, כי הן נקראות בתוך רינדור. הכתיבות (יצירה,
 * הצטרפות, יציאה) נהיו אסינכרוניות, כי השרת יכול לדחות — קוד לא
 * קיים, זירה מלאה, כבר חבר — ועדכון אופטימי היה מראה למשתמש
 * שהוא בפנים ואז מוציא אותו.
 *
 * החתימות של הקריאות לא השתנו. `Arena.tsx` לא ידע שמשהו קרה.
 */
import {
  canJoin, isValidCode, normalizeCode,
  type JoinResult, type LeagueMember, type PrivateLeague,
} from './leagues.ts';
import { JoinError } from './leagues.ts';
import type { ModeId } from './events/bus.ts';
import { supabase } from './supabase.ts';
import { ensureIdentity } from './identity.ts';

/* ================================================================== */
/* תמונת המצב                                                          */
/* ================================================================== */

const CACHE_KEY = 'dubid.leagues.cache.v2';

interface Snapshot {
  leagues: PrivateLeague[];
  members: LeagueMember[];
  live: boolean;
  loading: boolean;
}

const snap: Snapshot = { leagues: [], members: [], live: false, loading: true };

function notify() {
  try {
    window.dispatchEvent(new Event('dubid:store'));
  } catch { /* לא בדפדפן */ }
}

function readCache(): { leagues: PrivateLeague[]; members: LeagueMember[] } {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : { leagues: [], members: [] };
  } catch {
    return { leagues: [], members: [] };
  }
}

function writeCache() {
  try {
    localStorage.setItem(CACHE_KEY,
      JSON.stringify({ leagues: snap.leagues, members: snap.members }));
  } catch { /* גלישה פרטית */ }
}

/* ================================================================== */
/* טעינה                                                               */
/* ================================================================== */

let loading: Promise<void> | null = null;

/**
 * מביא את הזירות שלי ואת החברים שלהן. קריאות מקבילות מתאחדות.
 *
 * ★ כישלון אינו קטלני: התמונה נשארת (מטמון), `live` נופל, והמסך
 *   יכול לומר "לא מחובר" במקום להציג טבלה ישנה כאילו היא נכונה.
 */
export function hydrateLeagues(force = false): Promise<void> {
  if (loading && !force) return loading;

  loading = (async () => {
    snap.loading = true;
    notify();
    try {
      await ensureIdentity();
      const { data, error } = await supabase.rpc('my_leagues');
      if (error) throw error;

      const payload = (data ?? {}) as { leagues?: PrivateLeague[]; members?: LeagueMember[] };
      snap.leagues = payload.leagues ?? [];
      snap.members = payload.members ?? [];
      snap.live = true;
      writeCache();
    } catch {
      snap.live = false;
      if (snap.leagues.length === 0) {
        const cached = readCache();
        snap.leagues = cached.leagues;
        snap.members = cached.members;
      }
    } finally {
      snap.loading = false;
      loading = null;
      notify();
    }
  })();

  return loading;
}

export function leaguesStatus(): { live: boolean; loading: boolean } {
  return { live: snap.live, loading: snap.loading };
}

/* ================================================================== */
/* קריאה — סינכרונית                                                   */
/* ================================================================== */

export function listLeagues(): PrivateLeague[] {
  return snap.leagues;
}

export function listMembers(leagueId?: string): LeagueMember[] {
  return leagueId ? snap.members.filter((m) => m.leagueId === leagueId) : snap.members;
}

/**
 * הזירות שהמשתמש חבר בהן.
 *
 * ★ השרת כבר מחזיר רק אותן (`game.my_leagues` מסנן לפי
 *   `auth.uid()`), ולכן הסינון כאן הוא רק רשת ביטחון לזמן שבו
 *   התמונה עדיין מהמטמון של משתמש קודם באותו דפדפן.
 */
export function myLeagues(userId: string): PrivateLeague[] {
  const mine = new Set(
    snap.members.filter((m) => m.userId === userId).map((m) => m.leagueId),
  );
  return snap.leagues.filter((l) => mine.has(l.id));
}

export function findByCode(code: string): PrivateLeague | undefined {
  const norm = normalizeCode(code);
  return snap.leagues.find((l) => l.code === norm);
}

/* ================================================================== */
/* כתיבה — אסינכרונית, דרך השרת                                        */
/* ================================================================== */

function errorCode(err: unknown): string {
  const msg = err instanceof Error ? err.message
    : typeof err === 'object' && err && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err);
  const known = [
    'LEAGUE_NOT_FOUND', 'LEAGUE_FULL', 'ALREADY_MEMBER', 'LEAGUE_CLOSED',
    'OWNER_CANNOT_LEAVE', 'AUTH_REQUIRED', 'CODE_COLLISION',
  ].find((c) => msg.includes(c));
  return known ?? 'NETWORK';
}

export const LEAGUE_ERROR_HE: Record<string, string> = {
  LEAGUE_NOT_FOUND: 'לא נמצאה זירה עם הקוד הזה.',
  LEAGUE_FULL: 'הזירה מלאה.',
  ALREADY_MEMBER: 'כבר הצטרפת לזירה הזו.',
  LEAGUE_CLOSED: 'הזירה סגורה להצטרפות.',
  OWNER_CANNOT_LEAVE: 'מייסד לא יכול לצאת מהזירה שלו.',
  AUTH_REQUIRED: 'צריך זהות פעילה. רעננו את הדף.',
  CODE_COLLISION: 'קרתה תקלה ביצירת הקוד. נסו שוב.',
  NETWORK: 'אין חיבור לשרת. נסו שוב בעוד רגע.',
};

export function leagueMessageHe(code: string): string {
  return LEAGUE_ERROR_HE[code] ?? LEAGUE_ERROR_HE.NETWORK;
}

/**
 * יוצר זירה. המייסד מצורף על ידי השרת באותה טרנזקציה — זירה בלי
 * מייסד היא מצב שאסור שיתקיים.
 *
 * ★ הקוד נוצר בשרת, לא כאן. שני דפדפנים שיצרו זירה באותה שנייה
 *   יכלו לגרוע את אותו קוד מ-`Math.random`, וההתנגשות הייתה
 *   שולחת משתמש לזירה של זרים. `UNIQUE` על העמודה + לולאת ניסיון
 *   בשרת סוגרים את זה במקום אחד.
 */
export async function createLeague(input: {
  name: string;
  mode: ModeId;
  ownerId: string;
  ownerName: string;
  maxMembers?: number | null;
}): Promise<PrivateLeague> {
  await ensureIdentity();
  const { data, error } = await supabase.rpc('create_league', {
    p_name: input.name.trim().slice(0, 40) || 'הזירה שלי',
    p_mode: input.mode,
    p_max_members: input.maxMembers ?? null,
  });
  if (error) throw new Error(errorCode(error));

  await hydrateLeagues(true);

  const row = data as { id?: string; code?: string } | null;
  const created = row?.id ? snap.leagues.find((l) => l.id === row.id) : undefined;
  if (created) return created;

  throw new Error('NETWORK');
}

/**
 * הצטרפות בקוד.
 *
 * ★ הבדיקה קורית פעמיים, ובכוונה. `canJoin` הטהורה נותנת הודעה
 *   מיידית ומדויקת בלי הלוך-ושוב; השרת בודק שוב כי הוא היחיד
 *   שיודע את המצב האמיתי ברגע הזה. אם הם לא מסכימים — השרת צודק.
 */
export async function joinByCode(
  code: string,
  userId: string,
  _displayName: string,
): Promise<JoinResult & { league?: PrivateLeague }> {
  const norm = normalizeCode(code);
  if (!isValidCode(norm)) return { ok: false, error: JoinError.NotFound };

  // אם הזירה כבר בתמונה (למשל חבר שיתף קוד לזירה שאני בה) —
  // עונים מיד בלי לפנות לשרת.
  const known = findByCode(norm);
  if (known) {
    const verdict = canJoin(known, listMembers(known.id), userId);
    if (!verdict.ok) return verdict;
  }

  try {
    const { error } = await supabase.rpc('join_league', { p_code: norm });
    if (error) throw error;
  } catch (err) {
    const code2 = errorCode(err);
    if (code2 === 'ALREADY_MEMBER') {
      await hydrateLeagues(true);
      return { ok: false, error: JoinError.AlreadyMember };
    }
    if (code2 === 'LEAGUE_FULL')   return { ok: false, error: JoinError.Full };
    if (code2 === 'LEAGUE_CLOSED') return { ok: false, error: JoinError.Closed };
    return { ok: false, error: JoinError.NotFound };
  }

  await hydrateLeagues(true);
  const league = findByCode(norm);
  return league ? { ok: true, league } : { ok: false, error: JoinError.NotFound };
}

/** יציאה מזירה. המייסד לא יכול — הכלל נאכף בשרת, לא רק כאן. */
export async function leaveLeague(leagueId: string, _userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('leave_league', { p_league_id: leagueId });
    if (error) throw error;
    await hydrateLeagues(true);
    return data === true;
  } catch {
    return false;
  }
}

/**
 * הצצה לזירה לפי קוד, לפני ההצטרפות.
 *
 * ★ למה בכלל: "הצטרפת לזירה של אנשים שלא הכרת" הוא לא מצב שאפשר
 *   לבטל בנוחות — המייסד כבר רואה אותך בטבלה. השרת מחזיר שם,
 *   מצב ומספר משתתפים; לא שמות ולא הרכבים, כי מי שיש לו קוד עוד
 *   אינו חבר.
 */
export interface LeaguePeek {
  name: string;
  mode: ModeId;
  kind: 'arena' | 'open';
  status: 'active' | 'closed';
  members: number;
  maxMembers: number | null;
}

export async function peekByCode(code: string): Promise<LeaguePeek | null> {
  const norm = normalizeCode(code);
  if (!isValidCode(norm)) return null;
  try {
    const { data, error } = await supabase.rpc('league_by_code', { p_code: norm });
    if (error || !data) return null;
    return data as LeaguePeek;
  } catch {
    return null;
  }
}
