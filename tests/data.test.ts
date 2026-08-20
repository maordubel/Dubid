/**
 * טסטים לדאטה של הסגלים — הדברים שנשברים בשקט כשמעדכנים את הקובץ.
 *   node --experimental-strip-types --test tests/data.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LEAGUE, TEAMS, PLAYERS, TEAM_BY_ID, shortName,
         LEAGUE_TEAM_COUNT_REAL } from '../src/data/squads.ts';
import { resolveRules, IL_PREMIER } from '../src/lib/scoring/rules.ts';
import { checkLeagueCapacity } from '../src/lib/scoring/validate.ts';
import { createEmptyLineup } from '../src/lib/lineup.ts';
import { validateLineup, teamCoverage } from '../src/lib/scoring/validate.ts';
import type { Position } from '../src/lib/scoring/types.ts';

test('הליגה והעונה נטענו', () => {
  assert.equal(LEAGUE.code, 'IL_PREMIER');
  assert.match(LEAGUE.season, /^\d{4}\/\d{4}$/);
});

test('כל שחקן משויך לקבוצה קיימת ולעמדה חוקית', () => {
  const valid: Position[] = ['GK', 'DEF', 'MID', 'FWD'];
  for (const p of PLAYERS) {
    assert.ok(TEAM_BY_ID.has(p.teamId), `${p.nameHe}: קבוצה לא קיימת ${p.teamId}`);
    assert.ok(valid.includes(p.position), `${p.nameHe}: עמדה לא חוקית ${p.position}`);
    assert.ok(p.nameHe.length > 1 && p.nameEn.length > 1);
  }
});

test('אין מזהי שחקן או קבוצה כפולים', () => {
  assert.equal(new Set(PLAYERS.map((p) => p.id)).size, PLAYERS.length);
  assert.equal(new Set(TEAMS.map((t) => t.id)).size, TEAMS.length);
});

test('לכל קבוצה יש קיצור ייחודי לתצוגה', () => {
  const shorts = TEAMS.map((t) => t.short);
  assert.equal(new Set(shorts).size, shorts.length, `קיצורים כפולים: ${shorts}`);
  for (const s of shorts) assert.ok(s.length <= 4, `קיצור ארוך מדי: ${s}`);
});

test('shortName מחזיר שם משפחה', () => {
  assert.equal(shortName('עומר גלזר'), 'גלזר');
  assert.equal(shortName('פדראו'), 'פדראו');
});

test('★ אזהרה: אין מספיק קבוצות להרכב מלא של 11', () => {
  // הטסט הזה מתעד את המצב הנוכחי במפורש. כשיעלו כל 14 הקבוצות
  // הוא ייכשל — וזה בדיוק מה שאמור לקרות, כתזכורת לעדכן את הציפייה.
  assert.ok(TEAMS.length < LEAGUE_TEAM_COUNT_REAL,
    'הקובץ כבר מכיל את כל הקבוצות — עדכנו את הטסט הזה');

  const issue = checkLeagueCapacity(TEAMS.length, IL_PREMIER);
  assert.ok(issue, 'עם פחות מ-11 קבוצות חייבת להיות שגיאה');
  assert.equal(issue!.params.available, TEAMS.length);
  assert.equal(issue!.params.missing, 11 - TEAMS.length);
});

test('מצב הדגמה: ההרכב מוקטן אבל הכלל של שחקן-אחד-לקבוצה נשמר', () => {
  const r = resolveRules(TEAMS.length);
  assert.equal(r.isDemo, true);
  assert.equal(r.rules.constraints.maxPlayersPerTeam, 1);
  assert.equal(r.rules.constraints.lineupSize, TEAMS.length);
});

test('אפשר להרכיב הרכב חוקי מהדאטה שקיים', () => {
  const r = resolveRules(TEAMS.length);
  const formation = r.rules.constraints.formationAllowed[0];
  const lineup = createEmptyLineup(formation, {
    lineupId: 'L', userId: 'U', gameweekId: 'GW1',
  });

  // מילוי חמדני: לכל משבצת, השחקן הראשון בעמדה מקבוצה שעוד לא נלקחה
  const taken = new Set<string>();
  for (const slot of lineup.slots) {
    const pick = PLAYERS.find((p) => p.position === slot.position && !taken.has(p.teamId));
    assert.ok(pick, `אין שחקן פנוי לעמדה ${slot.position}`);
    taken.add(pick!.teamId);
    slot.playerId = pick!.id;
    slot.teamId = pick!.teamId;
  }
  lineup.slots[0].isCaptain = true;

  assert.deepEqual(validateLineup(lineup, r.rules), []);

  const cov = teamCoverage(lineup, TEAMS.map((t) => t.id), r.rules);
  assert.equal(cov.filter((c) => c.filled).length, r.rules.constraints.lineupSize);
});

test('הרכב ריק לא עובר ולידציה (משבצות ריקות אינן שחקנים)', () => {
  const r = resolveRules(TEAMS.length);
  const empty = createEmptyLineup(r.rules.constraints.formationAllowed[0], {
    lineupId: 'L', userId: 'U', gameweekId: 'GW1',
  });
  const issues = validateLineup(empty, r.rules);
  assert.ok(issues.length > 0);
  assert.ok(issues.some((i) => i.code === 'lineup_size'));
});
