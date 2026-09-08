/**
 * טסטים לדאטה של הסגלים — הדברים שנשברים בשקט כשמעדכנים את הקובץ.
 *   node --experimental-strip-types --test tests/data.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { LEAGUE, TEAMS, PLAYERS, TEAM_BY_ID, shortName, PLAYERS_BY_TEAM,
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
test('★ כל קיצור הוא מילה קריאה, לא רצף אותיות', () => {
  /*
   * ★★ הבאג שהבדיקה הזו קיימת בשבילו ★★
   *
   * הפורמט הקודם היה `<אות>.<עיר>` בכל הקבוצות, והוא יצר מילים
   * אמיתיות בעברית: `ה.ים` נקרא "הים", `ע.קש` נקרא "עקש",
   * `מ.תא` נקרא "מתא". נקודה בין שתי אותיות עבריות אינה מפריד
   * חזק מספיק — העין קוראת את הרצף כמילה לפני שהיא מגיעה אליה.
   *
   * שני כללים מחליפים אותו:
   *   · המפריד הוא `·` ולא נקודה. הוא לא סימן פיסוק, ולכן לא
   *     נבלע לתוך המילה.
   *   · **רוב הקבוצות לא צריכות אות מועדון בכלל.** בליגה יש
   *     שש ערים עם קבוצה יחידה, ושם שם העיר הוא גם הקצר וגם
   *     הברור ביותר.
   */
  for (const t of TEAMS) {
    assert.ok(!t.short.includes('.'), `נקודה בקיצור: ${t.short} (${t.nameHe})`);
    assert.match(t.short, /^[א-ת]/, `${t.nameHe}: ${t.short}`);
  }
});

test('★★ שני קיצורים זהים = שתי קבוצות שאי אפשר להבחין ביניהן', () => {
  const shorts = TEAMS.map((t) => t.short);
  assert.equal(new Set(shorts).size, shorts.length, `קיצורים כפולים: ${shorts}`);
});

test('★ הקיצורים שנקבעו במפורש — נעולים', () => {
  /* ★ ארבע-עשרה שורות שנכתבו ביד. כלל נגזר היה נשבר על
     ירושלים, על "בני סכנין" שאין בה מילת מועדון סטנדרטית,
     ועל בית"ר — שהיא המועדון היחיד בשם הזה בליגה, ולכן שם
     המועדון לבדו ברור יותר מכל קיצור של עיר. */
  const EXPECT: Record<string, string> = {
    T1: 'ב״ש',    T2: 'ה·י-ם',  T3: 'מ·ת״א',  T4: 'מ·חיפה',
    T5: 'בית״ר',  T6: 'ה·ת״א',  T7: 'נתניה',  T8: 'סכנין',
    T9: 'ה·חיפה', T10: 'קר״ש',  T11: 'טבריה', T12: 'מ·פ״ת',
    T13: 'ר״ג',   T14: 'ה·פ״ת',
  };
  for (const t of TEAMS) {
    assert.equal(t.short, EXPECT[t.id], `${t.nameHe} (${t.id})`);
  }
});

test('★ אורך הקיצור נשאר בגבול שהמסך יכול להציג', () => {
  // 6 תווים הוא מה שנכנס בתג `TeamTag` בגודל xs בלי חיתוך.
  for (const t of TEAMS) {
    assert.ok(t.short.length <= 6, `קיצור ארוך מדי: ${t.short} (${t.short.length})`);
  }
});

test('★★ גם הריבוע הזעיר מבחין בין כל ארבע-עשרה', () => {
  /*
   * ★ הבאג שזה תופס.
   *
   * `TeamCrest` נופל לריבוע של שני תווים כשאין סמל וגם אין
   * מקום לחולצה. אם שתי קבוצות מקבלות שם את אותם שני תווים,
   * המשתמש רואה שני ריבועים זהים בשני צבעים — וזה נראה כמו
   * באג רינדור, לא כמו שתי קבוצות.
   *
   * הכלל מועתק כאן במכוון ולא מיובא: `TeamCrest` הוא קומפוננטת
   * React ואי אפשר לייבא אותה לבדיקת דאטה טהורה. אם הכלל שם
   * ישתנה — הבדיקה הזו תמשיך לעבור, ולכן היא נועלת את
   * **התוצאה** ולא את המימוש.
   */
  const micro = (short: string) => {
    const clean = short.replace(/[״׳"'-]/g, '');
    const dot = clean.search(/[·.]/);
    if (dot > 0 && dot + 1 < clean.length) return clean[0] + clean[dot + 1];
    return clean.slice(0, 2);
  };
  const all = TEAMS.map((t) => micro(t.short));
  assert.equal(new Set(all).size, all.length, `ריבועים כפולים: ${all}`);
  for (const m of all) assert.equal(m.length, 2, `ריבוע לא בן שני תווים: ${m}`);
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

/* ================================================================== */
/* סגלים אחרי עדכון מחזורים 1–3 — מה שנשבר בפועל                       */
/* ================================================================== */

test('★ אין שחקן שרשום בשתי קבוצות', () => {
  /* הבאג האמיתי שנתפס: יונס מלדה, עומר אבוהב, עדן שמיר ואריאל
     מנדי הופיעו כל אחד בשני סגלים בבת אחת — כי מעבר קבוצה נכנס
     כשורה חדשה בלי שהישנה נסגרה. במסך זה נראה כמו שני שחקנים
     שונים, וב"שחקן אחד מכל קבוצה" זו פרצה: אותו אדם ממלא שתי
     משבצות. */
  const seen = new Map<string, string>();
  const clashes: string[] = [];
  for (const p of PLAYERS) {
    const prev = seen.get(p.nameHe);
    if (prev && prev !== p.teamId) clashes.push(`${p.nameHe}: ${prev} + ${p.teamId}`);
    seen.set(p.nameHe, p.teamId);
  }
  /* שני שחקנים שונים עם אותו שם הם מצב חוקי (נועם כהן בהפועל
     חיפה ובהפועל פ"ת). לכן הרשימה הזו היא היוצאים מן הכלל
     המאושרים — וכל שם חדש שנכנס אליה חייב הצדקה. */
  const KNOWN_NAMESAKES = ['נועם כהן'];
  const unexpected = clashes.filter((c) => !KNOWN_NAMESAKES.some((n) => c.startsWith(`${n}:`)));
  assert.deepEqual(unexpected, [], `שחקן בשתי קבוצות:\n${unexpected.join('\n')}`);
});

test('★ שחקן שעזב אינו ניתן לבחירה', () => {
  /* `game.squads()` מסנן `status <> 'left'`. אם הקליינט היה
     כולל אותם, המסך היה מציע שחקן שהשרת דוחה בהגשה. */
  const source = JSON.parse(
    readFileSync(new URL('../scripts/squads.source.json', import.meta.url), 'utf8'),
  ) as { teams: { players: { id: number; status?: string }[] }[] };
  const left = source.teams.flatMap((t) => t.players.filter((p) => p.status === 'left'));
  assert.ok(left.length > 0, 'הקובץ אמור לסמן שחקנים שעזבו');
  const pickable = new Set(PLAYERS.map((p) => p.id));
  for (const p of left) assert.ok(!pickable.has(`P${p.id}`), `P${p.id} עזב אך ניתן לבחירה`);
});

test('★ מספר חולצה ייחודי בתוך הקבוצה', () => {
  /* שני שחקנים עם אותו מספר בכרטיסים סמוכים = משתמש שבוחר
     את מי שלא התכוון אליו. */
  for (const { team, players } of PLAYERS_BY_TEAM) {
    const nums = players.map((p) => p.shirt).filter((n): n is number => n != null);
    assert.equal(new Set(nums).size, nums.length, `${team.nameHe}: מספר חולצה כפול`);
  }
});

test('★ אין תווים זרים בתוך שם עברי', () => {
  /* נתפס בפועל: "יון ניקולאescu", "קארים קิมבדי", "ציפיקה סонגה".
     שם כזה לא נמצא בשום חיפוש ולא מתאים לשום ספק דאטה. */
  const FOREIGN = /[A-Za-zЀ-ӿ؀-ۿ฀-๿]/;
  const bad = PLAYERS.filter((p) => FOREIGN.test(p.nameHe)).map((p) => `${p.id} ${p.nameHe}`);
  assert.deepEqual(bad, []);
});
