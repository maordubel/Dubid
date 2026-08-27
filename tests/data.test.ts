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

/**
 * ★ הפורמט החדש: `<אות המועדון>.<העיר>`
 *
 * הקודם היה בגרשיים — `הב״ש`, `מ״ח`, `מפ״ת`, `הפ״ת` — והוא לא היה
 * קריא: `מפ״ת` ו-`הפ״ת` נבדלים באות אחת בתוך רצף שנראה כמעט זהה.
 * הנקודה מפרידה בין המועדון לעיר, והעין קוראת שני חלקים.
 *
 * הבדיקה הזו נועלת את **הצורה**, לא רק את הייחודיות: היא מה
 * שיתפוס בנייה מחדש מ-JSON ישן.
 */
test('★ הקיצורים בפורמט <מועדון>.<עיר>', () => {
  for (const t of TEAMS) {
    assert.match(t.short, /^[א-ת]\.[א-ת]{2,6}$/, `${t.nameHe}: ${t.short}`);
    // הפורמט הישן חייב להיעלם לגמרי — גרש אחד ששרד הוא קבוצה
    // שנשארה מאחור בבנייה מחדש.
    assert.ok(!/[״׳"']/.test(t.short), `גרשיים בקיצור: ${t.short}`);
  }
});

test('★★ שני קיצורים זהים = שתי קבוצות שאי אפשר להבחין ביניהן', () => {
  const shorts = TEAMS.map((t) => t.short);
  assert.equal(new Set(shorts).size, shorts.length, `קיצורים כפולים: ${shorts}`);
});

test('★ הקיצורים שנקבעו במפורש — נעולים', () => {
  // ★ ארבע-עשרה שורות שנכתבו ביד. כלל נגזר היה נשבר על ירושלים
  //   (`ים` ולא `ירושלים`) ועל "בני סכנין" שאין בה מילת מועדון
  //   סטנדרטית — ולכן יש כאן טבלה, וכאן היא נבדקת.
  const EXPECT: Record<string, string> = {
    T1: 'ה.בש',   T2: 'ה.ים',    T3: 'מ.תא',    T4: 'מ.חיפה',
    T5: 'ב.ים',   T6: 'ה.תא',    T7: 'מ.נתניה', T8: 'ב.סכנין',
    T9: 'ה.חיפה', T10: 'ע.קש',   T11: 'ע.טבריה', T12: 'מ.פת',
    T13: 'ה.רג',  T14: 'ה.פת',
  };
  for (const t of TEAMS) {
    assert.equal(t.short, EXPECT[t.id], `${t.nameHe} (${t.id})`);
  }
});

test('★ אורך הקיצור נשאר בגבול שהמסך יכול להציג', () => {
  // 8 תווים הוא מה שנכנס בתג `TeamTag` בגודל xs בלי חיתוך.
  for (const t of TEAMS) {
    assert.ok(t.short.length <= 8, `קיצור ארוך מדי: ${t.short}`);
  }
});

test('shortName מחזיר שם משפחה', () => {
  assert.equal(shortName('עומר גלזר'), 'גלזר');
  assert.equal(shortName('פדראו'), 'פדראו');
});

test('כל 14 הקבוצות עלו — ההרכב המלא של 11 פעיל, לא מצב הדגמה', () => {
  // הטסט הישן כאן תיעד במפורש שחסרות קבוצות ("★ אזהרה"). מאז עלו כל
  // 14 קבוצות ליגת העל האמיתיות, וזה בדיוק הרגע שהאזהרה ניבאה: הטסט
  // הזה מוודא שהמעבר למצב המלא קרה בפועל ולא נשאר תקוע ב"הדגמה".
  assert.equal(TEAMS.length, LEAGUE_TEAM_COUNT_REAL,
    `יש ${TEAMS.length} קבוצות, ליגת העל האמיתית מונה ${LEAGUE_TEAM_COUNT_REAL}`);

  const issue = checkLeagueCapacity(TEAMS.length, IL_PREMIER);
  assert.equal(issue, null, 'עם 14 קבוצות ומקסימום שחקן אחד לקבוצה, 11 שחקנים אפשריים בלי מצב הדגמה');
});

test('ההרכב המלא: 11 שחקנים, שחקן אחד מכל קבוצה, בלי מצב הדגמה', () => {
  const r = resolveRules(TEAMS.length);
  assert.equal(r.isDemo, false);
  assert.equal(r.rules.constraints.maxPlayersPerTeam, 1);
  assert.equal(r.rules.constraints.lineupSize, 11);
});

test('לכל קבוצה יש לפחות שוער אחד ומספיק שחקנים לכל עמדה', () => {
  for (const t of TEAMS) {
    const squad = PLAYERS.filter((p) => p.teamId === t.id);
    assert.ok(squad.some((p) => p.position === 'GK'), `${t.nameHe}: אין שוער בסגל`);
    assert.ok(squad.length >= 11, `${t.nameHe}: סגל קטן מדי (${squad.length})`);
  }
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
