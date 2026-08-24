/**
 * lib/leagues.ts — זירות וליגות.
 *
 * ★ מה זה כן: תחרות בין חברים.
 * ★ מה זה לא:  רשת חברתית.
 *
 * הברִיף מפורש בשלילה — בלי צ׳אט, בלי פיד, בלי הודעות. המטרה
 * היחידה היא "מי מנצח את מי בקבוצת הוואטסאפ". כל פיצ׳ר שלא משרת
 * את המשפט הזה לא שייך לכאן.
 *
 * ★ אותו דירוג בדיוק כמו בליגה הכללית
 *
 * הדירוג בליגה פרטית עובר דרך `rankEntries` — אותה היררכיית
 * שוברי שוויון של הדירוג הראשי. אילו הייתה כאן לוגיקת דירוג
 * משלה, יום אחד משתמש היה רואה שהוא מנצח חבר בליגה הפרטית
 * ומפסיד לו בכללית. מקור אחד, תמיד.
 */
import { rankEntries, type TieBreakStage } from './scoring/ranking.ts';
import type { LineupScore } from './scoring/types.ts';
import type { ModeId } from './events/bus.ts';

/* =================================================================== */
/* מודל                                                                */
/* =================================================================== */

/**
 * ★ "זירה" ו"ליגה פרטית" הן אותו דבר.
 *
 * בעל המוצר הבהיר: זירה היא תחרות מול חברים עם קוד הצטרפות,
 * טבלה פנימית, וניקוד בלבד — **בלי קופה ובלי פרסים**. זה בדיוק
 * מה שהמודל הזה כבר עושה.
 *
 * לכן אין כאן מערכת שנייה. יש `kind` אחד שמבדיל בין שני סוגי
 * תחרות שחולקים את אותה טבלה ואותם שוברי שוויון:
 *
 *   'arena'  — פרטית. נכנסים עם קוד. ראש בראש מול חברים.
 *   'open'   — ציבורית. כולם בפנים, אין קוד.
 *
 * בניית שתי מערכות לשני הסוגים הייתה שכפול — ובדיוק מה
 * שהברִיף אוסר.
 */
export type CompetitionKind = 'arena' | 'open';

export interface PrivateLeague {
  id: string;
  name: string;
  kind: CompetitionKind;
  /** קוד ההצטרפות, מנורמל לאותיות גדולות. */
  code: string;
  ownerId: string;
  /**
   * ליגה שייכת למצב משחק אחד. הברִיף אוסר למזג ניקוד של דוביד 5
   * ודוביד 11 לטבלה תחרותית אחת — וזה חל גם כאן.
   */
  mode: ModeId;
  createdAt: string;
  status: 'active' | 'closed';
  /** תקרת משתתפים. null = ללא הגבלה. */
  maxMembers: number | null;
}

export interface LeagueMember {
  leagueId: string;
  userId: string;
  displayName: string;
  joinedAt: string;
}

/* =================================================================== */
/* קודי הצטרפות                                                        */
/* =================================================================== */

/**
 * אלפבית ללא תווים מתחזים.
 * אין 0/O, אין 1/I/L — קוד שמוקרא בקול בקבוצת וואטסאפ חייב
 * להיות חד-משמעי, אחרת חצי מהחברים לא יצליחו להצטרף.
 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 6;

/**
 * מייצר קוד. מקבל מקור אקראיות כפרמטר כדי שאפשר יהיה לבדוק אותו.
 *
 * ★ אקראיות כאן מותרת ואף רצויה — הברִיף אוסר אקראיות ב*הכרעה
 *   תחרותית*, לא בהנפקת מזהים. קוד צפוי הוא פרצה, לא תכונה.
 */
export function makeInviteCode(random: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ALPHABET[Math.floor(random() * ALPHABET.length)];
  }
  return out;
}

/**
 * מנרמל קוד שהמשתמש הקליד.
 * אנשים מדביקים קודים עם רווחים, מקפים ואותיות קטנות. כל אלה
 * הם אותו קוד, ולדחות אותם זו רק דרך לאבד משתמש בשלב ההצטרפות.
 */
export function normalizeCode(input: string): string {
  // ★ רק ניקוי, בלי "תיקון חכם".
  //   ניסיון למפות O→0 או I→1 היה מסוכן: האלפבית שלנו לא מכיל
  //   *אף אחד* מהתווים האלה, ולכן כל מיפוי כזה הוא ניחוש. עדיף
  //   לדחות קוד לא תקין עם הודעה ברורה מאשר לשלוח משתמש לליגה
  //   של מישהו אחר.
  return [...input.toUpperCase()]
    .filter((c) => ALPHABET.includes(c))
    .join('')
    .slice(0, CODE_LENGTH);
}

export function isValidCode(code: string): boolean {
  return code.length === CODE_LENGTH && [...code].every((c) => ALPHABET.includes(c));
}

/** קישור הזמנה. הקוד בנתיב ולא ב-query — יפה יותר, ושורד העתקה. */
export function inviteUrl(origin: string, code: string): string {
  return `${origin.replace(/\/$/, '')}/l/${code}`;
}

/* =================================================================== */
/* הצטרפות                                                            */
/* =================================================================== */

export const JoinError = {
  NotFound: 'league_not_found',
  Closed: 'league_closed',
  Full: 'league_full',
  AlreadyMember: 'already_member',
  InvalidCode: 'invalid_code',
} as const;
export type JoinErrorValue = (typeof JoinError)[keyof typeof JoinError];

export const JOIN_ERROR_HE: Record<JoinErrorValue, string> = {
  league_not_found: 'לא נמצאה ליגה עם הקוד הזה.',
  league_closed: 'הליגה סגורה להצטרפות.',
  league_full: 'הליגה מלאה.',
  already_member: 'אתם כבר חברים בליגה הזו.',
  invalid_code: 'הקוד לא תקין. שישה תווים, בלי אפס ובלי האות O.',
};

export interface JoinResult {
  ok: boolean;
  error?: JoinErrorValue;
}

/**
 * בדיקת הצטרפות — טהורה. הכתיבה עצמה נעשית בשכבה שמעל
 * (localStorage היום, RPC ב-Supabase מחר).
 */
export function canJoin(
  league: PrivateLeague | undefined,
  members: readonly LeagueMember[],
  userId: string,
): JoinResult {
  if (!league) return { ok: false, error: JoinError.NotFound };
  if (league.status !== 'active') return { ok: false, error: JoinError.Closed };
  if (members.some((m) => m.userId === userId)) {
    return { ok: false, error: JoinError.AlreadyMember };
  }
  if (league.maxMembers !== null && members.length >= league.maxMembers) {
    return { ok: false, error: JoinError.Full };
  }
  return { ok: true };
}

/* =================================================================== */
/* טבלה                                                               */
/* =================================================================== */

/** תוצאת מחזור בודד של משתתף. */
export interface MemberGameweek {
  userId: string;
  gameweekId: string;
  score: LineupScore;
  submittedAt: string;
}

/**
 * ★ תחושת "ניצחון" ו"הפסד" בלי קופה.
 *
 * בעל המוצר ביקש אלמנטים של זכייה והפסד, אבל בלי כסף שמתחלק.
 * הפתרון: כל מחזור הוא **קרב** מול הטבלה. מי שסיים בחצי העליון
 * "ניצח" את המחזור, מי שבחצי התחתון "הפסיד". זה נותן שיא,
 * רצף, וסיפור — בלי מטבע ובלי תשלום.
 */
export interface Record_ {
  wins: number;
  losses: number;
  /** רצף נוכחי. חיובי = ניצחונות ברצף, שלילי = הפסדים. */
  streak: number;
  /** המקום הטוב ביותר שהושג בליגה. */
  bestRank: number | null;
}

export interface StandingRow {
  rank: number;
  /** המקום במחזור הקודם. null = טרם שיחק. */
  previousRank: number | null;
  /** חיובי = עלייה. null = אין מחזור קודם להשוות אליו. */
  movement: number | null;
  tied: boolean;
  brokenBy: TieBreakStage | null;
  userId: string;
  displayName: string;
  /** נקודות המחזור האחרון שנספר. */
  gameweekPoints: number;
  /** מצטבר בליגה. */
  totalPoints: number;
  played: number;
  record: Record_;
}

/**
 * בונה את הטבלה.
 *
 * `history` הוא כל תוצאות המחזורים של כל החברים. הפונקציה מסכמת,
 * מדרגת לפי המחזור האחרון (כדי לקבל שוברי שוויון אמיתיים), ואז
 * משווה למחזור הקודם כדי לחשב תנועה.
 */
export function standings(
  members: readonly LeagueMember[],
  history: readonly MemberGameweek[],
  /** סדר המחזורים, מהראשון לאחרון. קובע מה "המחזור האחרון". */
  gameweekOrder: readonly string[],
): StandingRow[] {
  if (members.length === 0) return [];

  const latest = gameweekOrder[gameweekOrder.length - 1];
  const previous = gameweekOrder.length > 1 ? gameweekOrder[gameweekOrder.length - 2] : null;

  // אינדוקס פעם אחת. בלעדיו כל שורה בטבלה סורקת את כל ההיסטוריה,
  // וליגה של 200 חברים על פני 38 מחזורים הופכת לסריקה מיותרת בכל רינדור.
  const byUserGw = new Map<string, MemberGameweek>();
  const playedByUser = new Map<string, number>();
  for (const h of history) {
    byUserGw.set(`${h.userId}|${h.gameweekId}`, h);
    playedByUser.set(h.userId, (playedByUser.get(h.userId) ?? 0) + 1);
  }
  const at = (userId: string, gwId: string | null) =>
    gwId === null ? undefined : byUserGw.get(`${userId}|${gwId}`);

  const totalsFor = (upTo: string | null) => {
    if (upTo === null) return new Map<string, number>();
    const allowed = new Set(gameweekOrder.slice(0, gameweekOrder.indexOf(upTo) + 1));
    const m = new Map<string, number>();
    for (const h of history) {
      if (!allowed.has(h.gameweekId)) continue;
      m.set(h.userId, (m.get(h.userId) ?? 0) + h.score.totalPoints);
    }
    return m;
  };

  const rankAt = (upTo: string | null) => {
    if (upTo === null) return new Map<string, number>();
    const totals = totalsFor(upTo);
    // ★ מדרגים דרך `rankEntries` — אותה היררכיה כמו בדירוג הראשי.
    //   הציון המצטבר מוזרק לתוך העותק, כדי ששובר השוויון הראשון
    //   (ניקוד כולל) יעבוד על הסכום ולא על מחזור בודד.
    const rows = members.map((mem) => {
      const last = at(mem.userId, upTo);
      const base: LineupScore =
        last?.score ??
        {
          lineupId: `none-${mem.userId}`, gameweekId: upTo, rulesetVersion: 0,
          players: [], bonusLines: [],
          personalPoints: 0, resultPoints: 0, captainPoints: 0,
          virtualPoints: 0, totalPoints: 0,
        };
      return {
        entry: mem,
        score: { ...base, totalPoints: totals.get(mem.userId) ?? 0 },
        submittedAt: last?.submittedAt ?? '',
      };
    });
    const ranked = rankEntries(rows);
    return new Map(ranked.map((r) => [r.entry.userId, r.rank]));
  };

  const prevRanks = rankAt(previous);
  const totals = totalsFor(latest ?? null);

  // ★ שיא ניצחונות/הפסדים — מחושב מחזור אחר מחזור.
  //   "ניצחון" = סיום בחצי העליון של הזירה באותו מחזור.
  const records = new Map<string, Record_>();
  for (const m of members) {
    records.set(m.userId, { wins: 0, losses: 0, streak: 0, bestRank: null });
  }
  for (const gwId of gameweekOrder) {
    const played = members
      .map((m) => ({ userId: m.userId, pts: at(m.userId, gwId)?.score.totalPoints }))
      .filter((x): x is { userId: string; pts: number } => x.pts !== undefined)
      .sort((a, b) => b.pts - a.pts || a.userId.localeCompare(b.userId));
    if (played.length < 2) continue;   // פחות משניים — אין מול מי לנצח

    const half = played.length / 2;
    played.forEach((entry, i) => {
      const rec = records.get(entry.userId);
      if (!rec) return;
      const rank = i + 1;
      rec.bestRank = rec.bestRank === null ? rank : Math.min(rec.bestRank, rank);
      if (i < half) {
        rec.wins += 1;
        rec.streak = rec.streak >= 0 ? rec.streak + 1 : 1;
      } else {
        rec.losses += 1;
        rec.streak = rec.streak <= 0 ? rec.streak - 1 : -1;
      }
    });
  }

  const rows = members.map((mem) => {
    const last = at(mem.userId, latest ?? null);
    const base: LineupScore =
      last?.score ??
      {
        lineupId: `none-${mem.userId}`, gameweekId: latest ?? '', rulesetVersion: 0,
        players: [], bonusLines: [],
        personalPoints: 0, resultPoints: 0, captainPoints: 0,
        virtualPoints: 0, totalPoints: 0,
      };
    return {
      entry: mem,
      score: { ...base, totalPoints: totals.get(mem.userId) ?? 0 },
      submittedAt: last?.submittedAt ?? '',
      gameweekPoints: last?.score.totalPoints ?? 0,
      played: playedByUser.get(mem.userId) ?? 0,
    };
  });

  return rankEntries(rows).map((r) => {
    const src = rows.find((x) => x.entry.userId === r.entry.userId)!;
    const prev = prevRanks.get(r.entry.userId) ?? null;
    return {
      rank: r.rank,
      previousRank: prev,
      movement: prev === null ? null : prev - r.rank,
      tied: r.tied,
      brokenBy: r.brokenBy,
      userId: r.entry.userId,
      displayName: r.entry.displayName,
      gameweekPoints: src.gameweekPoints,
      totalPoints: src.score.totalPoints,
      played: src.played,
      record: records.get(r.entry.userId) ?? { wins: 0, losses: 0, streak: 0, bestRank: null },
    };
  });
}
