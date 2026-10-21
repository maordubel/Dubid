// ecosystem/feed — byte-identical in every repo of the universe; owned by the contract; no provider field name outside its adapter file
/**
 * ecosystem/feed/scores365.ts — מתאם הגיבוי.
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
 * ★ 17.10.2026 — הוא **כן** מקור סטטיסטיקה. SofaScore נחסם (403
 *   מ-Supabase ומ-GitHub), ומבנה `game` של 365scores אומת מול
 *   שני משחקים אמיתיים (tests/fixtures/scores365-game-*.json):
 *   לכל שחקן בהרכב יש `stats[]` עם דקות, שערים, בישולים, בעיטות,
 *   מסירות מפתח ועוד, ויש `events[]` עם שערים, כרטיסים והחלפות.
 *
 *   כללי האמון:
 *    1. שערים, בישולים, כרטיסים והחלפות נלקחים מ-`events[]`
 *       (ניתנים לביקורת, עם דקה). `stats[]` משמש לדקות, הצלות
 *       ולנתוני ה-extra, ומשמש גם כהצלבה.
 *    2. סכום השערים מהאירועים חייב להיות שווה לתוצאה. אחרת —
 *       התרעה **חוסמת** (`source_disagreement`), לא ניחוש.
 *    3. סוג אירוע שלא מוכר → `unknown_event`, לא התעלמות שקטה.
 */
import type {
  Alert, Fixture, FixtureStatus, Http, PlayerStat, Provider, RawBlob, TeamRef,
} from './types.ts';
import { concededWhileOn, num, toPosition, toShirt, type OnPitch } from './derive.ts';

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
  /* ★ משחק שנדחה/בוטל מגיע כ-statusGroup 4 ("הסתיים") עם ניקוד -1 לשני
     הצדדים ובלי מנצח. בלי הבדיקה הזו הוא נחשב 'finished' והמחזור היה
     מתקדם לניקוד על משחק שלא שוחק. */
  const text = String(game?.statusText ?? '');
  const noScore = typeof game?.homeCompetitor?.score === 'number' && game.homeCompetitor.score < 0
    && typeof game?.awayCompetitor?.score === 'number' && game.awayCompetitor.score < 0;
  if (/postpon|cancel|abandon|suspend/i.test(text)) return /abandon/i.test(text) ? 'abandoned' : 'postponed';
  if (group === 4 && noScore && num(game?.winner) <= 0) return 'postponed';
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


/* ------------------------------------------------------------------ *
 *  סטטיסטיקה אישית ממשחק אחד — `game.homeCompetitor.lineups.members`
 * ------------------------------------------------------------------ */

/** "39'" → 39 · "12/17 (71%)" → 12 · "0.68" → 0.68 · חסר → 0 */
export function statNumber(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  if (typeof raw !== 'string') return 0;
  const m = raw.match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

/* 'Goal Disallowed' (VAR) הוא שער שלא נספר — אין לו השפעה על ניקוד, לכן אינו התרעה. */
const S365_KNOWN_EVENTS = new Set(['Goal', 'Yellow Card', 'Red Card', 'Substitution', 'Woodwork', 'Goal Disallowed']);

interface PlayerTally {
  goals: number; assists: number; own: number; yellow: number; red: number; missedPen: number;
}

export function mapGameStats(
  fixture: Fixture,
  game: any,
  heGame?: any,
): { stats: PlayerStat[]; alerts: Alert[] } {
  const stats: PlayerStat[] = [];
  const alerts: Alert[] = [];
  if (!game?.homeCompetitor || !game?.awayCompetitor) {
    return { stats, alerts: [{
      kind: 'source_down', severity: 'warn',
      detail: { source: 'scores365', match: fixture.providerId, error: 'game ריק' },
    }] };
  }

  const homeId = game.homeCompetitor.id;
  const awayId = game.awayCompetitor.id;
  const events: any[] = Array.isArray(game.events) ? game.events : [];
  const names = new Map<number, any>();
  for (const m of game.members ?? []) names.set(m.id, m);
  /* ★ `game` חייב להיות בשפה 1 (אנגלית): שמות סוגי האירועים מתורגמים
     יחד עם השפה ("Goal" ← "שער"), והמיפוי כאן נשען על השמות האנגליים.
     שמות השחקנים והחולצות בעברית מגיעים מקריאה שנייה (`heGame`) —
     המזהים זהים בשתי השפות, וההתאמה לסגל נעשית לפי עברית. */
  const namesHe = new Map<number, any>();
  for (const m of heGame?.members ?? []) namesHe.set(m.id, m);

  /* ── אירועים → ספירה לכל שחקן + דקות שערים לכל צד ───────────── */
  const tally = new Map<number, PlayerTally>();
  const t = (id: number): PlayerTally => {
    let row = tally.get(id);
    if (!row) { row = { goals: 0, assists: 0, own: 0, yellow: 0, red: 0, missedPen: 0 }; tally.set(id, row); }
    return row;
  };
  /** דקות שערים שנזקפו **לטובת** כל צד (שער עצמי נזקף ליריבה). */
  const goalsFor = new Map<number, number[]>([[homeId, []], [awayId, []]]);
  const onAt = new Map<number, number>();   // שחקן → דקת כניסה
  const offAt = new Map<number, number>();  // שחקן → דקת יציאה
  const unknown = new Set<string>();
  const ownEvents: Array<{ competitorId: number; minute: number }> = [];

  const sorted = [...events].sort((a, b) => num(a?.order) - num(b?.order));
  for (const e of sorted) {
    const type = String(e?.eventType?.name ?? '');
    const sub = String(e?.eventType?.subTypeName ?? '');
    const minute = num(e?.gameTime);
    const pid = num(e?.playerId);

    if (type === 'Goal') {
      const own = /own/i.test(sub);
      if (own) t(pid).own += 1; else t(pid).goals += 1;
      for (const a of e?.extraPlayers ?? []) if (!own) t(num(a)).assists += 1;
      /* ★ למי נזקף שער עצמי: בלה ליגה (בארסה 7-2, 20.10.2026) competitorId של
         אירוע שער עצמי הוא **הצד שנהנה** מהשער. כדי לא להסתמך על הנחה, שני
         הכיוונים נבדקים מול התוצאה הסופית אחרי הלולאה (resolveOwnGoals). */
      if (own) ownEvents.push({ competitorId: e.competitorId, minute });
      else goalsFor.get(e.competitorId)?.push(minute);
    } else if (type === 'Yellow Card') {
      t(pid).yellow += 1;
    } else if (type === 'Red Card') {
      /* כרטיס אדום שני (צהוב-אדום) — הצהוב הראשון כבר נספר בנפרד */
      t(pid).red += 1;
    } else if (type === 'Substitution') {
      onAt.set(pid, minute);
      for (const off of e?.extraPlayers ?? []) offAt.set(num(off), minute);
    } else if (/penalt/i.test(type) && /(miss|fail|saved)/i.test(type)) {
      t(pid).missedPen += 1;
    } else if (!S365_KNOWN_EVENTS.has(type)) {
      unknown.add(type + (sub ? `/${sub}` : ''));
    }
  }

  if (unknown.size > 0) {
    alerts.push({
      kind: 'unknown_event', severity: 'warn',
      detail: { source: 'scores365', match: fixture.providerId, kinds: [...unknown] },
    });
  }

  /* ── שערים עצמיים: בוחרים את הכיוון שמתאים לתוצאה הסופית ─────────
     A = ה-competitorId הוא הנהנה (ברירת מחדל, כך נצפה). B = הוא הקבוצה של
     המבקיע. בלי תוצאה תקינה — A. דטרמיניסטי, בלי אקראיות. */
  {
    const hs0 = game.homeCompetitor.score;
    const as0 = game.awayCompetitor.score;
    const fix = (flip: boolean) => {
      const h = [...goalsFor.get(homeId)!]; const a = [...goalsFor.get(awayId)!];
      for (const o of ownEvents) {
        const ben = flip ? (o.competitorId === homeId ? awayId : homeId) : o.competitorId;
        (ben === homeId ? h : a).push(o.minute);
      }
      return { h, a };
    };
    const A = fix(false);
    const scoreOk = typeof hs0 === 'number' && typeof as0 === 'number' && hs0 >= 0 && as0 >= 0;
    const useFlip = scoreOk && !(A.h.length === hs0 && A.a.length === as0)
      && (() => { const B = fix(true); return B.h.length === hs0 && B.a.length === as0; })();
    const pick = useFlip ? fix(true) : A;
    goalsFor.set(homeId, pick.h);
    goalsFor.set(awayId, pick.a);
  }

  /* ── הצלבה: סכום השערים חייב להיות שווה לתוצאה ──────────────── */
  const hs = game.homeCompetitor.score;
  const as = game.awayCompetitor.score;
  const sumHome = goalsFor.get(homeId)!.length;
  const sumAway = goalsFor.get(awayId)!.length;
  if (typeof hs === 'number' && typeof as === 'number' && hs >= 0 && as >= 0
      && (sumHome !== hs || sumAway !== as)) {
    alerts.push({
      kind: 'source_disagreement', severity: 'block',
      detail: {
        source: 'scores365', match: fixture.providerId,
        score: [hs, as], fromEvents: [sumHome, sumAway],
      },
    });
  }

  /* ── שחקנים ────────────────────────────────────────────────── */
  for (const side of ['homeCompetitor', 'awayCompetitor'] as const) {
    const comp = game[side];
    const teamRef = side === 'homeCompetitor' ? fixture.home : fixture.away;
    const against = goalsFor.get(comp.id === homeId ? awayId : homeId) ?? [];

    for (const row of comp?.lineups?.members ?? []) {
      /* 1 = פותח · 2 = ספסל. 3 = חסר · 4 = סגל מקצועי — לא שיחקו */
      if (row?.status !== 1 && row?.status !== 2) continue;
      const pid = num(row?.id);
      if (!pid) continue;

      const byType = new Map<number, string>();
      for (const s of row?.stats ?? []) byType.set(s?.type, s?.value);
      const stat = (type: number) => statNumber(byType.get(type));

      const started = row.status === 1;
      let minutes = stat(30);
      /* ★ ספסלן בלי דקות ובלי סטטיסטיקה = לא עלה. שורת אפסים
         עבורו היא רעש, לא נתון. */
      if (!started && minutes === 0 && !row?.hasStats) continue;

      const from = started ? 0 : (onAt.get(pid) ?? -1);
      const to = started ? (offAt.get(pid) ?? null) : null;
      const window: OnPitch = { from, to };
      if (started && minutes === 0) minutes = to ?? 90;   // פותח בלי שדה דקות

      const tl = tally.get(pid) ?? { goals: 0, assists: 0, own: 0, yellow: 0, red: 0, missedPen: 0 };
      const member = names.get(pid);

      /* הצלבה פנימית: סטטיסטיקת הספק מול האירועים */
      if (byType.has(27) && stat(27) !== tl.goals) {
        alerts.push({
          kind: 'source_disagreement', severity: 'warn',
          detail: { source: 'scores365', match: fixture.providerId, player: pid,
                    field: 'goals', stat: stat(27), events: tl.goals },
        });
      }

      stats.push({
        matchProviderId: fixture.providerId,
        team: teamRef,
        player: {
          id: String(pid),
          nameEn: member?.name ?? null,
          nameHe: namesHe.get(pid)?.name ?? null,
          shirt: toShirt(member?.jerseyNumber ?? namesHe.get(pid)?.jerseyNumber),
          position: toPosition(row?.position?.name),
        },
        minutes,
        started,
        goals: tl.goals,
        assists: tl.assists,
        ownGoals: tl.own,
        yellowCards: tl.yellow,
        redCards: tl.red,
        saves: stat(23),
        penaltiesSaved: 0,
        penaltiesMissed: tl.missedPen,
        goalsConceded: minutes > 0 ? concededWhileOn(window, against) : 0,
        extra: {
          shots: stat(3),
          shotsOnTarget: stat(4),
          keyPasses: stat(46),
          bigChancesCreated: stat(24),
          dribblesWon: stat(54),
          tacklesWon: stat(39),
          interceptions: stat(41),
          clearances: stat(40),
          recoveries: stat(86),
          touches: stat(45),
          blocks: stat(59),
          foulsMade: stat(42),
          wasFouled: stat(37),
          providerRating: typeof row?.ranking === 'number' ? row.ranking : null,
        },
      });
    }
  }

  return { stats, alerts };
}


export function createScores365(http: Http, cfg: Scores365Config): Provider & {
  squad(teamProviderId: string): Promise<SquadRow[]>;
} {
  const base = cfg.base ?? S365_BASE;
  const lang = cfg.langId ?? 2;
  const q = `appTypeId=5&langId=${lang}&timezoneName=Asia/Jerusalem&competitions=${cfg.competitionId}`;

  /**
   * ★ `results` מחזיר רק את העמוד האחרון (שבעה משחקים). מחזור ישן —
   *   השלמה של מחזור 5 ב-17.10 — נמצא בעמודים הקודמים, שמקושרים
   *   ב-`paging.previousPage`. עוקבים עד שרואים מחזור נמוך מהמבוקש
   *   או עונה אחרת (אותו עמוד עשוי להכיל שתיהן), ולא יותר מ-6 עמודים.
   */
  async function games(downToRound?: number): Promise<any[]> {
    const origin = new URL(base).origin;
    const [first, fixtures] = await Promise.all([
      http(`${base}/games/results/?${q}`).catch(() => null),
      http(`${base}/games/fixtures/?${q}`).catch(() => null),
    ]);
    const out: any[] = [
      ...(Array.isArray(first?.games) ? first.games : []),
      ...(Array.isArray(fixtures?.games) ? fixtures.games : []),
    ];
    const season = Math.max(0, ...out.map((g) => num(g?.seasonNum)));

    let prev: string | undefined = first?.paging?.previousPage;
    for (let i = 0; downToRound !== undefined && prev && i < 6; i++) {
      const lowest = Math.min(
        Number.POSITIVE_INFINITY,
        ...out.filter((g) => num(g?.seasonNum) === season && num(g?.roundNum) > 0)
              .map((g) => num(g.roundNum)),
      );
      if (lowest < downToRound) break;
      const page = await http(`${origin}${prev}`).catch(() => null);
      if (!page) break;
      const games = (Array.isArray(page.games) ? page.games : [])
        .filter((g: any) => num(g?.seasonNum) === season);
      if (games.length === 0) break;            // עברנו לעונה קודמת
      out.push(...games);
      prev = page?.paging?.previousPage;
    }
    return out;
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
      const all = await games(n);
      const of = all.filter((g) => num(g?.roundNum) === n);
      const fixtures = of.map(mapGame).filter((f): f is Fixture => f !== null);
      return {
        fixtures,
        raw: [{ kind: 'round', externalId: String(n), payload: { games: of } }],
      };
    },

    async stats(fixtures): Promise<{ stats: PlayerStat[]; alerts: Alert[]; raw: RawBlob[] }> {
      const stats: PlayerStat[] = [];
      const alerts: Alert[] = [];
      const raw: RawBlob[] = [];

      for (const f of fixtures) {
        /* משחק שלא התחיל או נדחה אינו נסרק */
        if (f.status === 'scheduled' || f.status === 'postponed') continue;
        try {
          const url = (l: number) =>
            `${base}/game/?appTypeId=5&langId=${l}&timezoneName=Asia/Jerusalem&gameId=${f.providerId}`;
          /* אנגלית לאירועים (שמות יציבים), עברית לשמות — ראו mapGameStats */
          const [payload, heLoaded] = await Promise.all([
            http(url(1)),
            http(url(2)).catch(() => null),
          ]);
          raw.push({ kind: 'game', externalId: f.providerId, payload });
          const mapped = mapGameStats(f, payload?.game, heLoaded?.game);
          stats.push(...mapped.stats);
          alerts.push(...mapped.alerts);
        } catch (err) {
          /* ★ משחק אחד שנפל אינו מפיל מחזור. הוא מדווח. */
          alerts.push({
            kind: 'source_down', severity: 'warn',
            detail: { source: 'scores365', match: f.providerId, error: String(err) },
          });
        }
      }
      return { stats, alerts, raw };
    },

    async squad(teamProviderId) {
      const payload = await http(
        `${base}/squads/?appTypeId=5&langId=${lang}&competitors=${teamProviderId}`,
      );
      return mapSquad(payload, teamProviderId);
    },
  };
}
