/**
 * ⚠ נוצר אוטומטית — אל תערכו כאן.
 *
 * נבנה על ידי scripts/bundle-edge.mjs מתוך:
 *   src/lib/ingest/types.ts
 *   src/lib/ingest/derive.ts
 *   src/lib/ingest/sofascore.ts
 *   src/lib/ingest/scores365.ts
 *   src/lib/ingest/reconcile.ts
 *   supabase/functions/dubid-ingest/_src/handler.ts
 *
 * ★ קובץ אחד בכוונה. פריסה דרך ה-Dashboard היא הדבקה אחת:
 *   Edge Functions → dubid-ingest → index.ts → להחליף הכל.
 *   עורך ה-Dashboard לא יוצר תיקיות, וכל קובץ נוסף הוא עוד
 *   נקודת כשל שקטה. כבר היו שלוש.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/* ── src/lib/ingest/types.ts ──────────────────────── */

/**
 * src/lib/ingest/types.ts — החוזה הקנוני של הקליטה.
 *
 * ★ הכלל היחיד של הקובץ הזה: **שום שם שדה של ספק לא מופיע בו.**
 *
 * מתאם מחזיר `Snapshot`. `game.ingest_snapshot` במסד מקבל בדיוק
 * את המבנה הזה. להחליף ספק = לכתוב קובץ מתאם חדש, בלי לגעת
 * במסד, בלי לגעת במנוע הניקוד, ובלי לגעת בשום מסך.
 */

export type FixtureStatus =
  | 'scheduled' | 'live' | 'finished' | 'postponed' | 'abandoned';

export type Position = 'GK' | 'DEF' | 'MID' | 'FWD';

export interface TeamRef {
  /** המזהה אצל הספק. המסד קושר אותו פעם אחת ומאז זה חיפוש מפתח. */
  id: string;
  nameEn?: string | null;
  nameHe?: string | null;
}

export interface PlayerRef {
  id: string;
  nameEn?: string | null;
  nameHe?: string | null;
  shirt?: number | null;
  position?: Position | null;
}

export interface Fixture {
  providerId: string;
  home: TeamRef;
  away: TeamRef;
  /** ISO-8601. null = שעה לא פורסמה. לעולם לא ממציאים אחת. */
  kickoff: string | null;
  status: FixtureStatus;
  homeGoals?: number | null;
  awayGoals?: number | null;
}

/** ביצועי שחקן במשחק אחד — בדיוק השדות שמנוע הניקוד צורך. */
export interface PlayerStat {
  matchProviderId: string;
  team: TeamRef;
  player: PlayerRef;
  minutes: number;
  started: boolean;
  goals: number;
  assists: number;
  ownGoals: number;
  yellowCards: number;
  redCards: number;
  saves: number;
  penaltiesSaved: number;
  penaltiesMissed: number;
  /** ספיגות **בזמן שהיה על המגרש**. ראו derive.ts. */
  goalsConceded: number;
  /**
   * כל השאר. נשמר ב-`core.player_match_stats.extra` ואינו משפיע
   * על ניקוד — עד שיוחלט שכן, וזה יהיה שינוי חוק ולא מיגרציה.
   */
  extra?: Record<string, unknown>;
}

export interface Alert {
  kind:
    | 'var'                  // החלטת VAR — הספק לא אומר איזה שער בוטל
    | 'card_rescinded'       // כרטיס שבוטל — נקודות שצריך להחזיר
    | 'unknown_event'        // אירוע שהמתאם לא ידע למפות
    | 'source_disagreement'  // שני מקורות, שתי תוצאות
    | 'source_down'
    | 'fixture_not_final';
  severity: 'block' | 'warn';
  detail: Record<string, unknown>;
}

export interface RawBlob {
  kind: string;
  externalId?: string | null;
  payload: unknown;
}

export interface Snapshot {
  phase: 'fixtures' | 'live' | 'final' | 'sweep' | 'squads';
  gameweek: { number: number };
  fixtures: Fixture[];
  stats: PlayerStat[];
  alerts: Alert[];
  raw: RawBlob[];
}

/**
 * הבאת JSON אחת. מוזרקת למתאם כדי שאפשר יהיה לבדוק אותו בלי רשת.
 *
 * ★ יושבת כאן ולא בכל מתאם: שני מתאמים שמגדירים `Http` משלהם
 *   אינם יכולים לחיות באותו קובץ, והפריסה ל-Dashboard דורשת
 *   בדיוק את זה — קובץ אחד.
 */
export type Http = (url: string) => Promise<any>;

/** מה שכל מתאם חייב לספק. */
export interface Provider {
  readonly name: string;
  /** מספר המחזור הנוכחי אצל הספק. */
  currentRound(): Promise<number>;
  /** לוח המשחקים של מחזור — בלי סטטיסטיקה. */
  round(n: number): Promise<{ fixtures: Fixture[]; raw: RawBlob[] }>;
  /** סטטיסטיקה אישית לכל משחק ברשימה. */
  stats(fixtures: Fixture[]): Promise<{
    stats: PlayerStat[];
    alerts: Alert[];
    raw: RawBlob[];
  }>;
}

export const emptySnapshot = (round: number, phase: Snapshot['phase']): Snapshot => ({
  phase,
  gameweek: { number: round },
  fixtures: [],
  stats: [],
  alerts: [],
  raw: [],
});

/* ── src/lib/ingest/derive.ts ──────────────────────── */

/**
 * src/lib/ingest/derive.ts — גזירות משותפות לכל המתאמים.
 *
 * ★ למה זה לא יושב בתוך המתאם
 *
 * "כמה ספג בזמן שהיה על המגרש" הוא חוק של המשחק, לא של הספק.
 * אם כל מתאם היה מחשב אותו בעצמו, שני מקורות היו נותנים שתי
 * תשובות לאותו משחק — וזו בדיוק הקטגוריה של באגים שמתגלים
 * דרך משתמש שסופר נקודות ידנית.
 *
 * המתאם מחלץ עובדות גולמיות (מי נכנס בדקה כמה, מתי נכנס שער).
 * החישוב קורה פעם אחת, כאן.
 */

/** חלון הימצאות על המגרש, בדקות משחק. */
export interface OnPitch {
  from: number;
  /** דקת יציאה. null = סיים את המשחק. */
  to: number | null;
}

/**
 * ספיגות בזמן שהיה על המגרש.
 *
 * ★ שער בדקה 45 לשחקן שהוחלף בדקה 45 — נספר.
 *   הגבול סגור משני הצדדים בכוונה: ספק שמדווח שער והחלפה
 *   באותה דקה אינו מבחין ביניהם, וחלוקה לטובת "לא ספג"
 *   הייתה נותנת שער נקי למי שהיה על המגרש כשספגו.
 */
export function concededWhileOn(window: OnPitch, opponentGoalMinutes: number[]): number {
  if (window.from < 0) return 0;
  const to = window.to ?? Number.POSITIVE_INFINITY;
  return opponentGoalMinutes.filter((m) => m >= window.from && m <= to).length;
}

/** דקות ששוחקו לפי החלון — גיבוי כשהספק לא מדווח. */
export function minutesFromWindow(window: OnPitch, fullTime = 90): number {
  const to = window.to ?? fullTime;
  return Math.max(0, Math.min(to, fullTime) - Math.max(0, window.from));
}

const POSITION_MAP: Record<string, Position> = {
  G: 'GK', GK: 'GK', GOALKEEPER: 'GK', 'שוער': 'GK',
  D: 'DEF', DF: 'DEF', DEF: 'DEF', DEFENDER: 'DEF', 'מגן': 'DEF',
  M: 'MID', MF: 'MID', MID: 'MID', MIDFIELDER: 'MID', 'קשר': 'MID',
  F: 'FWD', FW: 'FWD', FWD: 'FWD', A: 'FWD', ATT: 'FWD',
  FORWARD: 'FWD', STRIKER: 'FWD', 'חלוץ': 'FWD',
};

/**
 * עמדה.
 *
 * ★ מחזיר `null` ולא ניחוש. עמדה שגויה משנה את ערך השער
 *   (שוער 6 · חלוץ 4) ואת הבדיקה מול המערך — וזה נזק שקט.
 *   `null` פשוט אומר "אל תשתמש בעמדה כראיה במיפוי".
 */
export function toPosition(raw: unknown): Position | null {
  if (typeof raw !== 'string') return null;
  return POSITION_MAP[raw.trim().toUpperCase()] ?? null;
}

/** מספר חולצה — רק מספר שלם סביר. '' ו-0 אינם מספרי חולצה. */
export function toShirt(raw: unknown): number | null {
  const n = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 99 ? n : null;
}

/** מספר לא שלילי, בלי NaN ובלי undefined שמחליק ל-0 בטעות. */
export function num(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** ISO-8601 מ-unix seconds. null נשאר null — שעה לא ממציאים. */
export function isoFromUnix(seconds: unknown): string | null {
  const n = typeof seconds === 'number' ? seconds : Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

/* ── src/lib/ingest/sofascore.ts ──────────────────────── */

/**
 * src/lib/ingest/sofascore.ts — המתאם הראשי.
 *
 * ★ כל שם שדה של הספק נמצא בקובץ הזה ורק בו.
 *   בדיקה לפני פריסה: חיפוש של 'onTargetScoringAttempt' או
 *   'incidentClass' מחוץ לקובץ הזה חייב להחזיר אפס תוצאות.
 *
 * ★ מה נבדק בפועל מול מחזור 4 (13–15/09/2026):
 *   שבעת המשחקים, השעות, התוצאות, ההרכבים ו-60+ שדות לשחקן —
 *   כולל מכבי ת״א–הפועל ת״א 4:1.
 *
 * ★ מה **לא** נלקח מכאן: הדירוג (`rating`). הוא אלגוריתם סגור
 *   של צד שלישי שמשתנה בלי הודעה, ואי אפשר להסביר אותו
 *   למשתמש. הבריף דורש ניקוד שניתן להסבר. הוא נשמר ב-`extra`
 *   כמטא־דאטה בלבד.
 */

export interface SofascoreConfig {
  base?: string;
  tournamentId: number;
  seasonId: number;
}

const SOFA_BASE = 'https://api.sofascore.com/api/v1';

/* ------------------------------------------------------------------ *
 *  מיפוי סטטוס
 * ------------------------------------------------------------------ */
//  ★ 'suspended' ו-'interrupted' → abandoned ולא live.
//    משחק שהופסק אינו תוצאה, ומחזור לא ייסגר מעליו בטעות.
const SOFA_STATUS: Record<string, FixtureStatus> = {
  notstarted: 'scheduled',
  willstart: 'scheduled',
  delayed: 'scheduled',
  inprogress: 'live',
  finished: 'finished',
  postponed: 'postponed',
  canceled: 'abandoned',
  cancelled: 'abandoned',
  suspended: 'abandoned',
  interrupted: 'abandoned',
};

export function mapSofaStatus(raw: unknown): FixtureStatus {
  const key = String(raw ?? '').toLowerCase();
  return SOFA_STATUS[key] ?? 'scheduled';
}

const sofaTeam = (t: any): TeamRef => ({
  id: String(t?.id ?? ''),
  nameEn: t?.name ?? t?.fullName ?? null,
  nameHe: null,
});

export function mapFixture(event: any): Fixture | null {
  const id = event?.id;
  if (id === undefined || id === null) return null;

  return {
    providerId: String(id),
    home: sofaTeam(event.homeTeam),
    away: sofaTeam(event.awayTeam),
    kickoff: isoFromUnix(event.startTimestamp),
    status: mapSofaStatus(event?.status?.type),
    homeGoals: typeof event?.homeScore?.current === 'number' ? event.homeScore.current : null,
    awayGoals: typeof event?.awayScore?.current === 'number' ? event.awayScore.current : null,
  };
}

/* ------------------------------------------------------------------ *
 *  שערים — מי הבקיע נקבע מהתוצאה, לא מדגל הצד
 * ------------------------------------------------------------------ */
/**
 * ★ הפיתוי היה לקרוא את `isHome` של אירוע השער. הוא שקרי
 *   בשער עצמי: הספק מסמן בו את הצד שנזקף לזכותו, ושתי
 *   פרשנויות אפשריות נותנות שתי תשובות הפוכות לשאלה "מי ספג".
 *
 *   לכן: כל אירוע שער נושא תמונת מצב של התוצאה. הצד שהמספר
 *   שלו עלה הוא הצד שהבקיע. זה נכון גם לשער עצמי, גם לפנדל,
 *   וגם אם הספק ישנה מחר את משמעות `isHome`.
 */
export function goalMinutesBySide(incidents: any[]): { home: number[]; away: number[] } {
  const goals = incidents
    .filter((i) => i?.incidentType === 'goal')
    .slice()
    .sort((a, b) => num(a?.time) - num(b?.time));

  const home: number[] = [];
  const away: number[] = [];
  let prevHome = 0;
  let prevAway = 0;

  for (const g of goals) {
    const h = num(g?.homeScore);
    const a = num(g?.awayScore);
    const minute = num(g?.time);
    if (h > prevHome) home.push(minute);
    else if (a > prevAway) away.push(minute);
    prevHome = h;
    prevAway = a;
  }
  return { home, away };
}

/* ------------------------------------------------------------------ *
 *  חלונות הימצאות על המגרש
 * ------------------------------------------------------------------ */
export function onPitchWindows(
  incidents: any[],
  starters: Set<string>,
): Map<string, OnPitch> {
  const windows = new Map<string, OnPitch>();
  for (const id of starters) windows.set(id, { from: 0, to: null });

  for (const inc of incidents) {
    if (inc?.incidentType !== 'substitution') continue;
    const minute = num(inc?.time);
    const inId = inc?.playerIn?.id !== undefined ? String(inc.playerIn.id) : null;
    const outId = inc?.playerOut?.id !== undefined ? String(inc.playerOut.id) : null;

    if (outId) {
      const w = windows.get(outId);
      if (w) w.to = minute;
      else windows.set(outId, { from: 0, to: minute });
    }
    if (inId) windows.set(inId, { from: minute, to: null });
  }
  return windows;
}

/* ------------------------------------------------------------------ *
 *  כרטיסים — עם כיבוד ביטול
 * ------------------------------------------------------------------ */
/**
 * ★ `rescinded` הוא השדה שמונע את התרחיש "המשתמש הפסיד נקודה
 *   על כרטיס שבוטל". כרטיס מבוטל פשוט לא נספר — ואם הוא
 *   בוטל **אחרי** שהמחזור פורסם, הקליטה מתריעה (ראו index.ts).
 */
export function cardsByPlayer(incidents: any[]): Map<string, { yellow: number; red: number }> {
  const out = new Map<string, { yellow: number; red: number }>();

  for (const inc of incidents) {
    if (inc?.incidentType !== 'card') continue;
    if (inc?.rescinded === true) continue;

    const id = inc?.player?.id !== undefined ? String(inc.player.id) : null;
    if (!id) continue;

    const cls = String(inc?.incidentClass ?? '').toLowerCase();
    const row = out.get(id) ?? { yellow: 0, red: 0 };
    if (cls === 'yellow') row.yellow += 1;
    else if (cls === 'red') row.red += 1;
    else if (cls === 'yellowred') { row.yellow += 1; row.red += 1; }
    out.set(id, row);
  }
  return out;
}

export function ownGoalsByPlayer(incidents: any[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const inc of incidents) {
    if (inc?.incidentType !== 'goal') continue;
    if (String(inc?.incidentClass ?? '').toLowerCase() !== 'owngoal') continue;
    const id = inc?.player?.id !== undefined ? String(inc.player.id) : null;
    if (!id) continue;
    out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}

export function missedPenaltiesByPlayer(incidents: any[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const inc of incidents) {
    const cls = String(inc?.incidentClass ?? '').toLowerCase();
    if (cls !== 'missed' && cls !== 'missedpenalty') continue;
    if (inc?.incidentType === 'penaltyShootout') continue;   // פנדלים אחרי 120' אינם ניקוד
    const id = inc?.player?.id !== undefined ? String(inc.player.id) : null;
    if (!id) continue;
    out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  האירועים שהמתאם לא ידע למפות
 * ------------------------------------------------------------------ */
const KNOWN_EVENTS = new Set([
  'period', 'injuryTime', 'goal', 'card', 'substitution',
  'penaltyShootout', 'inGamePenalty',
]);

export function unknownEventKinds(incidents: any[]): string[] {
  const seen = new Set<string>();
  for (const inc of incidents) {
    const t = String(inc?.incidentType ?? '');
    if (t && t !== 'varDecision' && !KNOWN_EVENTS.has(t)) seen.add(t);
  }
  return [...seen];
}

/* ------------------------------------------------------------------ *
 *  משחק אחד → שורות שחקנים
 * ------------------------------------------------------------------ */
export function mapMatchStats(
  fixture: Fixture,
  lineups: any,
  incidentsPayload: any,
): { stats: PlayerStat[]; alerts: Alert[] } {
  const stats: PlayerStat[] = [];
  const alerts: Alert[] = [];
  const incidents: any[] = Array.isArray(incidentsPayload?.incidents)
    ? incidentsPayload.incidents
    : Array.isArray(incidentsPayload) ? incidentsPayload : [];

  const goals = goalMinutesBySide(incidents);
  const cards = cardsByPlayer(incidents);
  const ownGoals = ownGoalsByPlayer(incidents);
  const missed = missedPenaltiesByPlayer(incidents);

  const starters = new Set<string>();
  for (const side of ['home', 'away'] as const) {
    for (const p of lineups?.[side]?.players ?? []) {
      if (p?.substitute === false && p?.player?.id !== undefined) {
        starters.add(String(p.player.id));
      }
    }
  }
  const windows = onPitchWindows(incidents, starters);

  /* ★ VAR: לא מוחל אוטומטית. האירוע לא אומר איזה שער בוטל,
     וניחוש כאן משנה דירוג. עולה כהתרעה חוסמת. */
  const varEvents = incidents.filter((i) => i?.incidentType === 'varDecision');
  if (varEvents.length > 0) {
    alerts.push({
      kind: 'var',
      severity: 'block',
      detail: {
        match: fixture.providerId,
        count: varEvents.length,
        minutes: varEvents.map((v) => num(v?.time)),
      },
    });
  }

  /* כרטיס שבוטל — מעניין גם כשהוא לא נספר, כי ייתכן שכבר ניקדנו אותו */
  const rescinded = incidents.filter((i) => i?.incidentType === 'card' && i?.rescinded === true);
  if (rescinded.length > 0) {
    alerts.push({
      kind: 'card_rescinded',
      severity: 'warn',
      detail: {
        match: fixture.providerId,
        players: rescinded.map((c) => c?.player?.name ?? null),
      },
    });
  }

  const unknown = unknownEventKinds(incidents);
  if (unknown.length > 0) {
    alerts.push({
      kind: 'unknown_event',
      severity: 'warn',
      detail: { match: fixture.providerId, kinds: unknown },
    });
  }

  for (const side of ['home', 'away'] as const) {
    const teamRef = side === 'home' ? fixture.home : fixture.away;
    const against = side === 'home' ? goals.away : goals.home;

    for (const row of lineups?.[side]?.players ?? []) {
      const pid = row?.player?.id;
      if (pid === undefined || pid === null) continue;
      const id = String(pid);
      const st = row?.statistics ?? {};

      /* ★ שחקן בלי דקות ובלי סטטיסטיקה = לא ירד למגרש.
         שורת אפסים עבורו אינה נתון — היא רעש שמסתיר חוסר. */
      const minutes = num(st?.minutesPlayed);
      if (minutes === 0 && Object.keys(st).length === 0) continue;

      const window = windows.get(id) ?? { from: 0, to: minutes > 0 ? null : 0 };
      const card = cards.get(id) ?? { yellow: 0, red: 0 };

      stats.push({
        matchProviderId: fixture.providerId,
        team: teamRef,
        player: {
          id,
          nameEn: row?.player?.name ?? null,
          nameHe: null,
          shirt: toShirt(row?.shirtNumber ?? row?.jerseyNumber ?? row?.player?.jerseyNumber),
          position: toPosition(row?.position ?? row?.player?.position),
        },
        minutes,
        started: row?.substitute === false,
        goals: num(st?.goals),
        assists: num(st?.goalAssist),
        ownGoals: ownGoals.get(id) ?? 0,
        yellowCards: card.yellow,
        redCards: card.red,
        saves: num(st?.saves),
        penaltiesSaved: 0,
        penaltiesMissed: missed.get(id) ?? 0,
        goalsConceded: minutes > 0 ? concededWhileOn(window, against) : 0,
        extra: {
          shots: num(st?.totalShots),
          shotsOnTarget: num(st?.onTargetScoringAttempt),
          keyPasses: num(st?.keyPass),
          bigChancesCreated: num(st?.bigChanceCreated),
          dribblesWon: num(st?.wonContest),
          dribblesAttempted: num(st?.totalContest),
          tacklesWon: num(st?.wonTackle),
          tackles: num(st?.totalTackle),
          interceptions: num(st?.interceptionWon),
          clearances: num(st?.totalClearance),
          recoveries: num(st?.ballRecovery),
          duelsWon: num(st?.duelWon),
          aerialsWon: num(st?.aerialWon),
          passesAccurate: num(st?.accuratePass),
          passes: num(st?.totalPass),
          touches: num(st?.touches),
          savesInsideBox: num(st?.savedShotsFromInsideTheBox),
          /* מטא־דאטה בלבד — לא מנקד. ראו הערת הפתיחה. */
          providerRating: typeof st?.rating === 'number' ? st.rating : null,
        },
      });
    }
  }

  return { stats, alerts };
}

/* ------------------------------------------------------------------ *
 *  הספק
 * ------------------------------------------------------------------ */
export function createSofascore(http: Http, cfg: SofascoreConfig): Provider {
  const base = cfg.base ?? SOFA_BASE;
  const t = cfg.tournamentId;
  const s = cfg.seasonId;

  return {
    name: 'sofascore',

    async currentRound() {
      const data = await http(`${base}/unique-tournament/${t}/season/${s}/rounds`);
      const n = data?.currentRound?.round;
      if (!Number.isInteger(n)) throw new Error('sofascore: currentRound חסר');
      return n as number;
    },

    async round(n) {
      const data = await http(`${base}/unique-tournament/${t}/season/${s}/events/round/${n}`);
      const events: any[] = Array.isArray(data?.events) ? data.events : [];
      const fixtures = events.map(mapFixture).filter((f): f is Fixture => f !== null);
      const raw: RawBlob[] = [{ kind: 'round', externalId: String(n), payload: data }];
      return { fixtures, raw };
    },

    async stats(fixtures) {
      const stats: PlayerStat[] = [];
      const alerts: Alert[] = [];
      const raw: RawBlob[] = [];

      for (const f of fixtures) {
        /* משחק שלא התחיל אינו נסרק — אין מה לקרוא ואין למי לנקד */
        if (f.status === 'scheduled' || f.status === 'postponed') continue;

        try {
          const [lineups, incidents] = await Promise.all([
            http(`${base}/event/${f.providerId}/lineups`),
            http(`${base}/event/${f.providerId}/incidents`),
          ]);

          raw.push({ kind: 'lineups', externalId: f.providerId, payload: lineups });
          raw.push({ kind: 'incidents', externalId: f.providerId, payload: incidents });

          const mapped = mapMatchStats(f, lineups, incidents);
          stats.push(...mapped.stats);
          alerts.push(...mapped.alerts);
        } catch (err) {
          /* ★ משחק אחד שנפל אינו מפיל מחזור. הוא מדווח. */
          alerts.push({
            kind: 'source_down',
            severity: 'warn',
            detail: { match: f.providerId, error: String(err) },
          });
        }
      }

      return { stats, alerts, raw };
    },
  };
}

/* ── src/lib/ingest/scores365.ts ──────────────────────── */

/**
 * src/lib/ingest/scores365.ts — מתאם הגיבוי.
 *
 * ★ שלושה תפקידים, ולא ארבעה:
 *
 *   1. **הצלבה.** שני מקורות שמסכימים על תוצאה = פרסום בטוח.
 *      שניים שחולקים = התרעה חוסמת, וזו בדיוק הסיבה שהוא כאן.
 *   2. **רשת ביטחון.** המקור הראשי נפל או נחסם → הלוח, השעות
 *      והתוצאות עדיין מגיעים.
 *   3. **גשר שמות.** הוא מחזיר שמות **בעברית** עם מספרי חולצה,
 *      וזה מה שמחבר בין קובץ הסגלים (עברית בלבד, 457 שחקנים)
 *      לבין המקור הראשי (לטינית בלבד).
 *
 * ★ מה שהוא **לא** עושה: הוא אינו מקור הסטטיסטיקה. מבנה
 *   הסטטיסטיקה שלו לא אומת מול נתון אמיתי, ולנחש מבנה זה
 *   לכתוב נקודות שאיש לא בדק. `stats()` מחזיר רשימה ריקה
 *   והתרעה — ולא מספרים שנראים אמיתיים.
 */

export interface Scores365Config {
  base?: string;
  competitionId: number;
  /** 2 = עברית. זו הסיבה המרכזית להחזיק את המקור הזה. */
  langId?: number;
}

const S365_BASE = 'https://webws.365scores.com/web';

/**
 * ★ טבלת הסטטוסים היא **שמרנית בכוונה**: כל מה שלא מזוהה
 *   בוודאות כ"הסתיים" חוזר כ-'scheduled'. מקור גיבוי שמכריז
 *   בטעות "הסתיים" יגרום לסגירת מחזור מוקדמת, וזה הנזק הגדול
 *   ביותר שמקור משני יכול לגרום.
 */
export function map365Status(game: any): FixtureStatus {
  const group = num(game?.statusGroup);
  const ended = game?.gameTimeAndStatusDisplayType === 1
    || group === 4
    || num(game?.winner) > 0;

  if (ended) return 'finished';
  if (group === 3 || num(game?.gameTime) > 0) return 'live';
  return 'scheduled';
}

/** שעה שלא ניתן לפרש היא `null`. לעולם לא ניחוש. */
export function parseKickoff(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const s365Team = (c: any): TeamRef => ({
  id: String(c?.id ?? ''),
  nameEn: c?.nameForURL ?? null,
  nameHe: c?.name ?? null,      // ← הערך שבגללו המקור הזה קיים
});

export function mapGame(game: any): Fixture | null {
  if (game?.id === undefined || game?.id === null) return null;
  return {
    providerId: String(game.id),
    home: s365Team(game.homeCompetitor),
    away: s365Team(game.awayCompetitor),
    kickoff: parseKickoff(game.startTime),
    status: map365Status(game),
    homeGoals: typeof game?.homeCompetitor?.score === 'number' && game.homeCompetitor.score >= 0
      ? game.homeCompetitor.score : null,
    awayGoals: typeof game?.awayCompetitor?.score === 'number' && game.awayCompetitor.score >= 0
      ? game.awayCompetitor.score : null,
  };
}

/** סגל בעברית — הצד שלו בגשר השמות. */
export interface SquadRow {
  providerId: string;
  nameHe: string | null;
  shirt: number | null;
  teamProviderId: string;
}

export function mapSquad(payload: any, teamProviderId: string): SquadRow[] {
  const list: any[] = payload?.squads?.[0]?.athletes
    ?? payload?.athletes
    ?? payload?.competitor?.squad
    ?? [];
  return list
    .filter((a) => a?.id !== undefined)
    .map((a) => ({
      providerId: String(a.id),
      nameHe: a?.name ?? null,
      shirt: toShirt(a?.jerseyNumber ?? a?.shirtNumber),
      teamProviderId,
    }));
}

export function createScores365(http: Http, cfg: Scores365Config): Provider & {
  squad(teamProviderId: string): Promise<SquadRow[]>;
} {
  const base = cfg.base ?? S365_BASE;
  const lang = cfg.langId ?? 2;
  const q = `appTypeId=5&langId=${lang}&timezoneName=Asia/Jerusalem&competitions=${cfg.competitionId}`;

  async function games(): Promise<any[]> {
    const [results, fixtures] = await Promise.all([
      http(`${base}/games/results/?${q}`).catch(() => null),
      http(`${base}/games/fixtures/?${q}`).catch(() => null),
    ]);
    return [
      ...(Array.isArray(results?.games) ? results.games : []),
      ...(Array.isArray(fixtures?.games) ? fixtures.games : []),
    ];
  }

  return {
    name: 'scores365',

    async currentRound() {
      const all = await games();
      /* המחזור הנוכחי = הנמוך ביותr שעדיין לא הסתיים כולו. */
      const byRound = new Map<number, boolean>();
      for (const g of all) {
        const r = num(g?.roundNum);
        if (!r) continue;
        const done = map365Status(g) === 'finished';
        byRound.set(r, (byRound.get(r) ?? true) && done);
      }
      const open = [...byRound.entries()].filter(([, done]) => !done).map(([r]) => r);
      if (open.length > 0) return Math.min(...open);
      const rounds = [...byRound.keys()];
      if (rounds.length === 0) throw new Error('scores365: אין מחזורים');
      return Math.max(...rounds);
    },

    async round(n) {
      const all = await games();
      const of = all.filter((g) => num(g?.roundNum) === n);
      const fixtures = of.map(mapGame).filter((f): f is Fixture => f !== null);
      return {
        fixtures,
        raw: [{ kind: 'round', externalId: String(n), payload: { games: of } }],
      };
    },

    async stats(): Promise<{ stats: PlayerStat[]; alerts: Alert[]; raw: RawBlob[] }> {
      /* ★ ראו הערת הפתיחה: אין כאן ניחוש מבנה. */
      return {
        stats: [],
        alerts: [{
          kind: 'unknown_event',
          severity: 'warn',
          detail: { source: 'scores365', note: 'מקור גיבוי — תוצאות ולוח בלבד, ללא סטטיסטיקה אישית' },
        }],
        raw: [],
      };
    },

    async squad(teamProviderId) {
      const payload = await http(
        `${base}/squads/?appTypeId=5&langId=${lang}&competitors=${teamProviderId}`,
      );
      return mapSquad(payload, teamProviderId);
    },
  };
}

/* ── src/lib/ingest/reconcile.ts ──────────────────────── */

/**
 * src/lib/ingest/reconcile.ts — מה קורה כששני מקורות לא מסכימים.
 *
 * ★ למה בכלל שני מקורות
 *
 * מקור יחיד הוא נקודת כשל יחידה בשני מובנים: הוא יכול ליפול,
 * והוא יכול **לטעות בשקט**. הראשון מורגש מיד; השני מתגלה רק
 * כשמשתמש סופר נקודות ידנית ומגלה שהשער של השחקן שלו נעלם.
 *
 * הכלל: המקור הראשי הוא זה שכותב. המקור המשני לא מתקן אותו —
 * הוא **חולק עליו**, וחילוקי דעות על תוצאה חוסמים פרסום.
 * המערכת אף פעם לא בוחרת לבד מי צודק.
 */

/** התאמת משחקים בין שני מקורות — לפי צמד הקבוצות, לא לפי מזהה. */
function keyOf(f: Fixture): string {
  const norm = (s: string | null | undefined) =>
    (s ?? '').toLowerCase().replace(/[^a-z֐-׿]/g, '');
  return [norm(f.home.nameEn) || norm(f.home.nameHe),
          norm(f.away.nameEn) || norm(f.away.nameHe)].join('|');
}

export interface Reconciliation {
  alerts: Alert[];
  /** כמה משחקים נבדקו בפועל בשני המקורות */
  compared: number;
  agreed: number;
}

export function reconcileFixtures(primary: Fixture[], backup: Fixture[]): Reconciliation {
  const alerts: Alert[] = [];
  const byKey = new Map(backup.map((f) => [keyOf(f), f]));
  let compared = 0;
  let agreed = 0;

  for (const p of primary) {
    const b = byKey.get(keyOf(p));
    if (!b) continue;

    /* משווים רק כששני הצדדים מכריזים "הסתיים" ויש תוצאה.
       מקור שעדיין מציג משחק חי אינו "חולק" — הוא מאחר. */
    const bothFinal = p.status === 'finished' && b.status === 'finished';
    const bothScored = p.homeGoals !== null && p.homeGoals !== undefined
      && b.homeGoals !== null && b.homeGoals !== undefined;
    if (!bothFinal || !bothScored) continue;

    compared += 1;
    if (p.homeGoals === b.homeGoals && p.awayGoals === b.awayGoals) {
      agreed += 1;
      continue;
    }

    alerts.push({
      kind: 'source_disagreement',
      severity: 'block',
      detail: {
        match: p.providerId,
        teams: `${p.home.nameEn ?? p.home.nameHe} – ${p.away.nameEn ?? p.away.nameHe}`,
        primary: `${p.homeGoals}-${p.awayGoals}`,
        backup: `${b.homeGoals}-${b.awayGoals}`,
      },
    });
  }

  return { alerts, compared, agreed };
}

/**
 * שמות בעברית מהמקור המשני, לפי צמד הקבוצות.
 *
 * ★ זה מה שהופך "Osher Davida" ל"אושר דוידה" בלי טרנסליטרציה.
 *   טרנסליטרציה היא ניחוש; חיבור לפי קבוצה ומספר חולצה הוא עובדה.
 */
export function hebrewByShirt(
  rows: Array<{ teamProviderId: string; shirt: number | null; nameHe: string | null }>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) {
    if (r.shirt === null || !r.nameHe) continue;
    out.set(`${r.teamProviderId}#${r.shirt}`, r.nameHe);
  }
  return out;
}

/* ── supabase/functions/dubid-ingest/_src/handler.ts ──────────────────────── */

/**
 * Supabase Edge Function — dubid-ingest
 *
 *   POST /functions/v1/dubid-ingest
 *   x-ingest-token: <INGEST_TOKEN>
 *   { "phase": "auto" | "fixtures" | "live" | "final" | "sweep", "round": 5 }
 *
 * ═══════════════════════════════════════════════════════════════
 *  מה הפונקציה הזו עושה
 * ═══════════════════════════════════════════════════════════════
 *
 *   1. שואלת את המקור הראשי מהו המחזור הנוכחי
 *   2. מושכת לוח + סטטיסטיקה, ומושכת גם את לוח **המחזור הבא**
 *   3. מצליבה מול מקור גיבוי — אי־הסכמה על תוצאה חוסמת פרסום
 *   4. שולחת JSON קנוני אחד ל-`game.ingest_snapshot`
 *   5. מריצה `game.auto_advance()`
 *   6. אם מחזור בשל: מריצה את **מנוע הניקוד הקיים** ואז מפרסמת
 *
 * ★ שלב 6 הוא הסיבה שהפונקציה הזו לא מחשבת ניקוד בעצמה. הניקוד
 *   הרשמי רץ ב-`dubid-score-gameweek`, שמריץ את אותו מנוע TS
 *   שרץ בדפדפן. מימוש שני היה יוצר שני מספרים לאותו מחזור.
 *
 * ★ הפונקציה לא כותבת לשום טבלה. נתיב הכתיבה היחיד הוא ה-RPC.
 *
 * ═══════════════════════════════════════════════════════════════
 *  פריסה — קובץ אחד. אחד.
 * ═══════════════════════════════════════════════════════════════
 *
 * ★ שתי פריסות נכשלו לפני שהמסקנה הזו התקבלה:
 *
 *     `./_lib/ingest/x.ts`  →  Module not found בזמן bundle
 *     שישה קבצים שטוחים      →  500 בכל קריאה, בלי שורה ביומן
 *
 *   עורך ה-Dashboard מוסיף קובץ אחד בשורש בלבד, ואין דרך לוודא
 *   ממנו שכל הקבצים נשמרו ושכל ייבוא נפתר. כל קובץ נוסף הוא
 *   עוד נקודת כשל שקטה.
 *
 *   לכן `index.ts` שנפרס הוא **קובץ בודד ומלא**, בלי שום ייבוא
 *   יחסי. מקור האמת נשאר `src/lib/ingest/` + הקובץ הזה, וה-
 *   `index.ts` נבנה מהם על ידי `scripts/bundle-edge.mjs`.
 *
 * ★ `phase: "ping"` — בדיקה שלא נוגעת ברשת ולא במסד. אם היא
 *   מחזירה 200, הפונקציה נטענה כראוי והבעיה בהמשך. אם גם היא
 *   מחזירה 500, הקובץ לא נטען בכלל. שאלה אחת, תשובה חד־משמעית.
 *
 * ═══════════════════════════════════════════════════════════════
 *  סודות (Settings → Edge Functions)
 * ═══════════════════════════════════════════════════════════════
 *
 *   INGEST_TOKEN            מחרוזת אקראית. מי שלא שולח אותה — נדחה.
 *   SOFASCORE_TOURNAMENT    266   (ליגת העל)
 *   SOFASCORE_SEASON        96740 (עונת 2026/27)
 *   SCORES365_COMPETITION   42
 *
 * `SUPABASE_URL` ו-`SUPABASE_SERVICE_ROLE_KEY` מוזרקים אוטומטית.
 */

/* ★ הייבוא הזה נמחק בבנייה (`scripts/bundle-edge.mjs`) והמודולים
   מוטמעים בקובץ אחד. הוא נשאר כאן כדי שאפשר יהיה לקרוא את
   הקובץ ולעקוב אחרי המקור. */

/** מזהה בנייה — מופיע ב-ping, כדי לדעת איזו גרסה באמת פרוסה. */
const BUILD = 'dubid-ingest/2';

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? 'https://dubid.dubelteam.com',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-ingest-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' },
  });

/**
 * רישום כישלון שאינו יכול להיכשל בעצמו.
 *
 * ★★ הבאג שהפונקציה הזו קיימת כדי שלא יחזור ★★
 *
 * הקוד היה `supabase.rpc(...).catch(() => {})`. ב-supabase-js v2
 * הבנאי שמוחזר מ-`rpc()` הוא **thenable בלבד**: יש לו `then`,
 * ואין לו `catch`. כלומר השורה הזו זרקה
 *
 *     TypeError: supabase.rpc(...).catch is not a function
 *
 * **מתוך בלוק ה-catch עצמו.** התוצאה הייתה הגרועה מכולן:
 * השגיאה המקורית נבלעה, הפונקציה קרסה מחוץ לכל טיפול, והפלטפורמה
 * החזירה "Internal Server Error" חלק — בלי גוף, בלי שורה ביומן
 * הריצות, ובלי שום דרך לדעת מה באמת נפל. שלוש שעות של איתור
 * הלכו על שגיאה שהייתה **במטפל בשגיאות**.
 *
 * הכלל: מטפל שגיאות לא מריץ שום דבר שיכול לזרוק, ואם הוא כן —
 * הוא עטוף בעצמו.
 */
async function logFailure(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => unknown },
  args: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.rpc('ingest_log_failure', args);
  } catch {
    /* אין לאן לדווח מכאן. הגוף של התשובה עדיין נושא את השגיאה. */
  }
}

/* ------------------------------------------------------------------ *
 *  HTTP אל הספקים
 * ------------------------------------------------------------------ */
/**
 * ★ שלוש החלטות, וכל אחת נובעת מכישלון אמיתי שקורה בשטח:
 *
 *   · User-Agent של דפדפן — בקשה בלי אחד נחסמת על ידי שכבת
 *     ההגנה של האתר, וזה נראה כמו "הספק נפל".
 *   · מרווח בין בקשות — עשרים בקשות ברצף מ-IP של שרת נראות
 *     כמו סריקה. שנייה אחת עולה בכלום ומונעת חסימה.
 *   · ניסיון חוזר פעמיים, ואז ויתור — לא לולאה. פונקציה
 *     שמנסה לנצח תיגמר בטיים־אאוט בלי שום דיווח.
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeHttp(gapMs = 900) {
  let last = 0;
  return async function http(url: string): Promise<any> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const wait = last + gapMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15_000);
      try {
        const res = await fetch(url, {
          signal: ctrl.signal,
          headers: { 'user-agent': UA, accept: 'application/json' },
        });
        clearTimeout(timer);
        if (res.status === 429 || res.status >= 500) {
          await sleep(1500 * (attempt + 1));
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
        return await res.json();
      } catch (err) {
        clearTimeout(timer);
        if (attempt === 2) throw err;
        await sleep(1200 * (attempt + 1));
      }
    }
    throw new Error(`נכשל אחרי שלושה ניסיונות: ${url}`);
  };
}

/* ------------------------------------------------------------------ *
 *  הריצה
 * ------------------------------------------------------------------ */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  /* ★ טוקן משלו ולא רק service_role: את הפונקציה קורא pg_cron
     דרך pg_net, ואסור ש-URL שדלף יריץ קליטה. */
  const expected = Deno.env.get('INGEST_TOKEN');
  const given = req.headers.get('x-ingest-token');
  if (!expected || given !== expected) return json({ error: 'forbidden' }, 403);

  /**
   * ★★ `db: { schema: 'game' }` — הדבר היחיד שהפיל את הקליטה ★★
   *
   * כל הפונקציות והטבלאות של המוצר יושבות בסכימת `game`.
   * PostgREST מגיש כמה סכימות, אבל **ברירת המחדל היא הראשונה
   * ברשימה** — `public`. לקוח בלי `db.schema` מחפש שם, ומקבל:
   *
   *     Could not find the function public.ingest_snapshot(...)
   *     in the schema cache
   *
   * הקליינט (`src/lib/supabase.ts`) מגדיר את זה מהיום הראשון.
   * ה-Edge Functions לא — ולכן הן נכשלו בקריאה הראשונה למסד.
   */
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { db: { schema: 'game' }, auth: { persistSession: false } },
  );

  const body = await req.json().catch(() => ({} as any));
  const phase: Snapshot['phase'] | 'auto' | 'ping' = body?.phase ?? 'auto';

  /* ★ דופק. בלי רשת, בלי מסד, בלי תלות בשום ספק.
     זו הבדיקה שאומרת "הקובץ נטען והסודות קיימים" — והיא מפרידה
     בין תקלת פריסה לתקלת ריצה בשאלה אחת. */
  if (phase === 'ping') {
    return json({
      ok: true,
      pong: true,
      version: BUILD,
      env: {
        supabaseUrl: Boolean(Deno.env.get('SUPABASE_URL')),
        serviceRole: Boolean(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')),
        tournament: Deno.env.get('SOFASCORE_TOURNAMENT') ?? null,
        season: Deno.env.get('SOFASCORE_SEASON') ?? null,
        competition: Deno.env.get('SCORES365_COMPETITION') ?? null,
      },
    });
  }

  const http = makeHttp();
  const primary = createSofascore(http, {
    tournamentId: Number(Deno.env.get('SOFASCORE_TOURNAMENT') ?? 266),
    seasonId: Number(Deno.env.get('SOFASCORE_SEASON') ?? 96740),
  });
  const backup = createScores365(http, {
    competitionId: Number(Deno.env.get('SCORES365_COMPETITION') ?? 42),
  });

  let round: number | null = Number.isInteger(body?.round) ? body.round : null;
  const done: unknown[] = [];

  try {
    /* ── 1. איזה מחזור ─────────────────────────────────────── */
    let source = primary;
    let usedBackup = false;

    if (round === null) {
      try {
        round = await primary.currentRound();
      } catch (err) {
        /* ★ המקור הראשי נפל — המחזור עדיין צריך להתקדם. */
        usedBackup = true;
        source = backup as unknown as typeof primary;
        round = await backup.currentRound();
        await logFailure(supabase, {
          p_source: 'sofascore', p_phase: 'fixtures',
          p_gw_code: null, p_error: String(err),
        });
      }
    }

    /* ── 2. לוח + סטטיסטיקה ────────────────────────────────── */
    const { fixtures, raw } = await source.round(round!);
    const alerts: Alert[] = [];

    const wantStats = phase === 'auto' || phase === 'live'
      || phase === 'final' || phase === 'sweep';

    let stats: Snapshot['stats'] = [];
    if (wantStats && !usedBackup) {
      const got = await primary.stats(fixtures);
      stats = got.stats;
      alerts.push(...got.alerts);
      raw.push(...got.raw);
    }

    /* ── 3. הצלבה מול הגיבוי ───────────────────────────────── */
    if (!usedBackup) {
      try {
        const b = await backup.round(round!);
        const rec = reconcileFixtures(fixtures, b.fixtures);
        alerts.push(...rec.alerts);
        done.push({ reconciled: rec.compared, agreed: rec.agreed });
      } catch (err) {
        alerts.push({
          kind: 'source_down', severity: 'warn',
          detail: { source: 'scores365', error: String(err) },
        });
      }
    }

    /* ── 4. כתיבה — קריאה אחת, טרנזקציה אחת ────────────────── */
    const snapshot: Snapshot = {
      phase: phase === 'auto' ? 'sweep' : (phase as Snapshot['phase']),
      gameweek: { number: round! },
      fixtures, stats, alerts, raw,
    };

    const { data: report, error } = await supabase.rpc('ingest_snapshot', {
      p_source: usedBackup ? backup.name : primary.name,
      p_payload: snapshot,
    });
    if (error) throw new Error(`ingest_snapshot: ${error.message}`);
    done.push({ ingest: report });

    /* ── 5. המחזור הבא — לוח בלבד, כדי שייווצר בזמן ───────── */
    //  ★ בלי זה, המחזור הבא נולד רק אחרי שהנוכחי פורסם, והמשתמש
    //    מגלה את המשחקים שלו יום לפני הדדליין.
    try {
      const next = await primary.round(round! + 1);
      if (next.fixtures.length > 0) {
        const { data: nextReport } = await supabase.rpc('ingest_snapshot', {
          p_source: primary.name,
          p_payload: {
            phase: 'fixtures',
            gameweek: { number: round! + 1 },
            fixtures: next.fixtures,
            stats: [], alerts: [], raw: next.raw,
          } satisfies Snapshot,
        });
        done.push({ nextRound: nextReport });
      }
    } catch {
      /* המחזור הבא עוד לא פורסם — מצב תקין לחלוטין */
    }

    /* ── 6. מחזור החיים ────────────────────────────────────── */
    const { data: advance, error: advErr } = await supabase.rpc('auto_advance');
    if (advErr) throw new Error(`auto_advance: ${advErr.message}`);
    done.push({ advance });

    /* ── 7. ניקוד רשמי ואז פרסום ───────────────────────────── */
    const ready = (advance as any)?.readyToPublish as string | null;
    if (ready) {
      const { data: gw } = await supabase
        .from('gameweeks').select('id').eq('code', ready).single();

      if (gw?.id) {
        const scored = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/dubid-score-gameweek`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            },
            body: JSON.stringify({ gameweekId: gw.id }),
          },
        );

        if (!scored.ok) {
          /* ★ ניקוד שנכשל **לא** מפרסם. מחזור מפורסם בלי ניקוד
             הוא טבלה ריקה שכל המשתמשים רואים בבת אחת. */
          await logFailure(supabase, {
            p_source: 'scoring', p_phase: 'final',
            p_gw_code: ready, p_error: `score-gameweek ${scored.status}`,
          });
          done.push({ publish: 'skipped_scoring_failed' });
        } else {
          const { error: pubErr } = await supabase.rpc('admin_set_published', {
            p_gw_code: ready, p_published: true,
          });
          done.push({ publish: pubErr ? `failed: ${pubErr.message}` : ready });
        }
      }
    }

    return json({ ok: true, round, source: usedBackup ? 'backup' : 'primary', done });

  } catch (err) {
    /* ★ התשובה נבנית **לפני** הרישום. אם הרישום ייפול, המשתמש
       עדיין מקבל את השגיאה האמיתית בגוף התשובה — וזה מה
       שמופיע בכרטיס "פעימות" במסך הקליטה. */
    const response = json({ ok: false, error: String(err), round }, 500);

    await logFailure(supabase, {
      p_source: 'dubid-ingest',
      p_phase: phase === 'auto' ? 'sweep' : String(phase),
      p_gw_code: round ? `gw-${round}` : null,
      p_error: String(err),
    });

    return response;
  }
});
