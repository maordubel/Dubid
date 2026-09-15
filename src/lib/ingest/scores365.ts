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
import type {
  Alert, Fixture, FixtureStatus, Http, PlayerStat, Provider, RawBlob, TeamRef,
} from './types.ts';
import { num, toShirt } from './derive.ts';

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
