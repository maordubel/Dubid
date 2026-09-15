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
import type {
  Alert, Fixture, FixtureStatus, Http, PlayerStat, Provider, RawBlob, TeamRef,
} from './types.ts';
import { concededWhileOn, isoFromUnix, num, toPosition, toShirt, type OnPitch } from './derive.ts';

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
