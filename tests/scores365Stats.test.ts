/**
 * tests/scores365Stats.test.ts — סטטיסטיקה ממקור הגיבוי, מול משחקים אמיתיים.
 *
 * הקבצים ב-tests/fixtures נשלפו מ-webws.365scores.com ב-17.10.2026
 * (מחזור 6). אין כאן נתון מומצא.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapGameStats, statNumber } from '../src/lib/ingest/scores365.ts';
import type { Fixture } from '../src/lib/ingest/types.ts';

const load = (id: number) =>
  JSON.parse(readFileSync(new URL(`./fixtures/scores365-game-${id}.json`, import.meta.url), 'utf8')).game;

const fixtureOf = (g: any): Fixture => ({
  providerId: String(g.id),
  home: { id: String(g.homeCompetitor.id), nameEn: g.homeCompetitor.name },
  away: { id: String(g.awayCompetitor.id), nameEn: g.awayCompetitor.name },
  kickoff: g.startTime, status: 'finished',
  homeGoals: g.homeCompetitor.score, awayGoals: g.awayCompetitor.score,
});

test('statNumber קורא את הפורמטים של הספק', () => {
  assert.equal(statNumber("39'"), 39);
  assert.equal(statNumber('12/17 (71%)'), 12);
  assert.equal(statNumber('0.68'), 0.68);
  assert.equal(statNumber(undefined), 0);
  assert.equal(statNumber('-'), 0);
});

for (const id of [4739316, 4739321]) {
  test(`משחק אמיתי ${id}: שערים מהאירועים = התוצאה, בלי התרעה חוסמת`, () => {
    const g = load(id);
    const { stats, alerts } = mapGameStats(fixtureOf(g), g);
    assert.equal(alerts.filter((a) => a.severity === 'block').length, 0, JSON.stringify(alerts));

    const total = stats.reduce((n, s) => n + s.goals + s.ownGoals, 0);
    assert.equal(total, g.homeCompetitor.score + g.awayCompetitor.score);
    assert.ok(stats.length >= 22 && stats.length <= 40, `שחקנים: ${stats.length}`);
    assert.ok(stats.every((s) => s.minutes > 0), 'אין שורת אפסים לשחקן שלא שיחק');
  });

  test(`משחק אמיתי ${id}: ספיגות של שוער = "Goals Conceded" של הספק`, () => {
    const g = load(id);
    const { stats } = mapGameStats(fixtureOf(g), g);
    for (const side of ['homeCompetitor', 'awayCompetitor'] as const) {
      for (const row of g[side].lineups.members) {
        if (row.status !== 1 || row.position?.name !== 'Goalkeeper') continue;
        const theirs = Number((row.stats.find((s: any) => s.type === 35)?.value) ?? 0);
        const ours = stats.find((s) => s.player.id === String(row.id));
        assert.ok(ours, 'שוער חסר');
        /* עד שוער שהוחלף — המדד שלנו הוא "בזמן שהיה על המגרש" */
        if (!g.events.some((e: any) => e.eventType.id === 1000 && (e.extraPlayers ?? []).includes(row.id))) {
          assert.equal(ours!.goalsConceded, theirs);
        }
      }
    }
  });

  test(`משחק אמיתי ${id}: דקות ופותחים`, () => {
    const g = load(id);
    const { stats } = mapGameStats(fixtureOf(g), g);
    const starters = stats.filter((s) => s.started);
    assert.equal(starters.length, 22);
    assert.ok(stats.every((s) => s.minutes <= 130));
  });
}

test('שער שלא מסתדר עם התוצאה → התרעה חוסמת, לא ניקוד שקט', () => {
  const g = load(4739316);
  g.homeCompetitor.score += 1;
  const { alerts } = mapGameStats(fixtureOf(g), g);
  assert.ok(alerts.some((a) => a.kind === 'source_disagreement' && a.severity === 'block'));
});

test('אירוע לא מוכר מדווח ולא נבלע', () => {
  const g = load(4739316);
  g.events.push({ order: 99, gameTime: 80, playerId: 1, eventType: { id: 77, name: 'Mystery' } });
  const { alerts } = mapGameStats(fixtureOf(g), g);
  assert.ok(alerts.some((a) => a.kind === 'unknown_event'));
});

test('שם עברי מגיע מהקריאה השנייה, והאירועים נשארים באנגלית', () => {
  const g = load(4739316);
  const he = structuredClone(g);
  for (const m of he.members) m.name = 'ע-' + m.id;
  for (const e of he.events) e.eventType.name = 'שער';   // כמו שהספק מחזיר בעברית
  const { stats, alerts } = mapGameStats(fixtureOf(g), g, he);
  assert.ok(stats.every((s) => typeof s.player.nameEn === 'string' && s.player.nameHe === 'ע-' + s.player.id));
  assert.equal(alerts.filter((a) => a.severity === 'block').length, 0);
});

test('בלי עברית השם העברי null — ולא שם אנגלי בשדה עברי', () => {
  const g = load(4739316);
  const { stats } = mapGameStats(fixtureOf(g), g);
  assert.ok(stats.every((s) => s.player.nameHe === null));
});

test('מחזור ישן נמצא בעמודים הקודמים, ועונה קודמת לא נערבבת', async () => {
  const { createScores365 } = await import('../src/lib/ingest/scores365.ts');
  const g = (id: number, round: number, season: number) => ({
    id, roundNum: round, seasonNum: season, statusGroup: 4,
    homeCompetitor: { id: 1, name: 'א', score: 1 }, awayCompetitor: { id: 2, name: 'ב', score: 0 },
    startTime: '2026-10-10T19:00:00+03:00',
  });
  const pages: Record<string, any> = {
    results: { games: [g(60, 6, 9)], paging: { previousPage: '/web/games/?p=1' } },
    fixtures: { games: [g(70, 7, 9)] },
    p1: { games: [g(50, 5, 9), g(40, 4, 9)], paging: { previousPage: '/web/games/?p=2' } },
    p2: { games: [g(33, 33, 8)], paging: { previousPage: '/web/games/?p=3' } },
  };
  const seen: string[] = [];
  const http = async (url: string) => {
    seen.push(url);
    if (url.includes('/games/results/')) return pages.results;
    if (url.includes('/games/fixtures/')) return pages.fixtures;
    if (url.endsWith('p=1')) return pages.p1;
    if (url.endsWith('p=2')) return pages.p2;
    throw new Error('unexpected ' + url);
  };
  const p = createScores365(http, { competitionId: 42 });
  const r5 = await p.round(5);
  assert.deepEqual(r5.fixtures.map((f) => f.providerId), ['50']);
  const r6 = await p.round(6);
  assert.deepEqual(r6.fixtures.map((f) => f.providerId), ['60']);
  assert.ok(!seen.some((u) => u.endsWith('p=2')), 'מחזור 5 נמצא בעמוד 1 — לא ממשיכים אחורה');
});

test('שער שנפסל ב-VAR אינו unknown_event ואינו נספר', () => {
  const fx: any = { providerId: 'x1' };
  const game = {
    homeCompetitor: { id: 1, score: 0 }, awayCompetitor: { id: 2, score: 0 },
    events: [{ eventType: { name: 'Goal Disallowed', subTypeName: 'Var' }, playerId: 10, competitorId: 1, gameTime: 33, order: 1 }],
    members: [],
  };
  const r = mapGameStats(fx, game);
  assert.equal(r.alerts.filter((a: any) => a.kind === 'unknown_event').length, 0);
});

test('שער עצמי: הכיוון נבחר לפי התוצאה הסופית, בשני הסימונים של הספק', () => {
  const mk = (competitorId: number) => ({
    homeCompetitor: { id: 1, score: 1 }, awayCompetitor: { id: 2, score: 0 },
    events: [{ eventType: { name: 'Goal', subTypeName: 'Own Goal' }, playerId: 20, competitorId, gameTime: 12, order: 1 }],
    members: [],
  });
  const fx: any = { providerId: 'og' };
  for (const c of [1, 2]) {
    const r = mapGameStats(fx, mk(c));
    assert.equal(r.alerts.filter((a: any) => a.kind === 'source_disagreement').length, 0, `competitorId=${c}`);
  }
  /* ובלה ליגה: 7-2 עם שער עצמי של האורחת (competitorId = המארחת הנהנית) */
  const r2 = mapGameStats(fx, {
    homeCompetitor: { id: 1, score: 7 }, awayCompetitor: { id: 2, score: 2 },
    events: [
      ...Array.from({ length: 6 }, (_, i) => ({ eventType: { name: 'Goal', subTypeName: '' }, playerId: 30 + i, competitorId: 1, gameTime: 5 + i, order: i + 1 })),
      { eventType: { name: 'Goal', subTypeName: 'Own Goal' }, playerId: 40, competitorId: 1, gameTime: 60, order: 7 },
      ...[0, 1].map((i) => ({ eventType: { name: 'Goal', subTypeName: '' }, playerId: 50 + i, competitorId: 2, gameTime: 70 + i, order: 8 + i })),
    ],
    members: [],
  });
  assert.equal(r2.alerts.filter((a: any) => a.kind === 'source_disagreement').length, 0);
});
