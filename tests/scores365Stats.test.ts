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
    const { stats, alerts } = mapGameStats(fixtureOf(g), g, 1);
    assert.equal(alerts.filter((a) => a.severity === 'block').length, 0, JSON.stringify(alerts));

    const total = stats.reduce((n, s) => n + s.goals + s.ownGoals, 0);
    assert.equal(total, g.homeCompetitor.score + g.awayCompetitor.score);
    assert.ok(stats.length >= 22 && stats.length <= 40, `שחקנים: ${stats.length}`);
    assert.ok(stats.every((s) => s.minutes > 0), 'אין שורת אפסים לשחקן שלא שיחק');
  });

  test(`משחק אמיתי ${id}: ספיגות של שוער = "Goals Conceded" של הספק`, () => {
    const g = load(id);
    const { stats } = mapGameStats(fixtureOf(g), g, 1);
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
    const { stats } = mapGameStats(fixtureOf(g), g, 1);
    const starters = stats.filter((s) => s.started);
    assert.equal(starters.length, 22);
    assert.ok(stats.every((s) => s.minutes <= 130));
  });
}

test('שער שלא מסתדר עם התוצאה → התרעה חוסמת, לא ניקוד שקט', () => {
  const g = load(4739316);
  g.homeCompetitor.score += 1;
  const { alerts } = mapGameStats(fixtureOf(g), g, 1);
  assert.ok(alerts.some((a) => a.kind === 'source_disagreement' && a.severity === 'block'));
});

test('אירוע לא מוכר מדווח ולא נבלע', () => {
  const g = load(4739316);
  g.events.push({ order: 99, gameTime: 80, playerId: 1, eventType: { id: 77, name: 'Mystery' } });
  const { alerts } = mapGameStats(fixtureOf(g), g, 1);
  assert.ok(alerts.some((a) => a.kind === 'unknown_event'));
});

test('עברית: השם נשמר כ-nameHe', () => {
  const g = load(4739316);
  const { stats } = mapGameStats(fixtureOf(g), g, 2);
  assert.ok(stats.every((s) => s.player.nameEn === null && typeof s.player.nameHe === 'string'));
});
