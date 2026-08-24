/**
 * tests/gameweek.test.ts — מחזור חיים ונעילה.
 *
 * ★ הבדיקה החשובה כאן היא זו של הדדליין. היא מגנה על ההוגנות של
 *   כל התחרות, ולכן היא נבדקת שנייה לפני, בדיוק ברגע, ושנייה אחרי.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GameweekStatus, canTransition, nextStatuses, dueStatus,
  isSubmissionOpen, msUntilDeadline, areResultsVisible, isVisibleToUsers,
  countdown, daysLabel, type Gameweek,
} from '../src/lib/gameweek.ts';

const DEADLINE = '2026-08-29T18:00:00Z';
const T = Date.parse(DEADLINE);

const gw = (over: Partial<Gameweek> = {}): Gameweek => ({
  id: 'GW7', number: 7, label: 'מחזור 7',
  status: GameweekStatus.Open, deadlineAt: DEADLINE, ...over,
});

/* ---------------- מעברי מצב ---------------- */

test('המעברים החוקיים בלבד מותרים', () => {
  assert.equal(canTransition('draft', 'open'), true);
  assert.equal(canTransition('open', 'locked'), true);
  assert.equal(canTransition('locked', 'live'), true);
  assert.equal(canTransition('live', 'scoring'), true);
  assert.equal(canTransition('scoring', 'published'), true);
  assert.equal(canTransition('published', 'archived'), true);
});

test('★ אי אפשר לחזור מפרסום לפתיחה', () => {
  assert.equal(canTransition('published', 'open'), false);
  assert.equal(canTransition('archived', 'open'), false);
  assert.equal(canTransition('live', 'open'), false);
  assert.deepEqual(nextStatuses('archived'), []);
});

test('תיקון אחורה מותר במקומות שהוגדרו', () => {
  assert.equal(canTransition('published', 'scoring'), true, 'תיקון ניקוד');
  assert.equal(canTransition('scoring', 'live'), true, 'משחק שלא הסתיים');
  assert.equal(canTransition('locked', 'open'), true, 'פתיחה מחדש בהחלטת אדמין');
});

/* ---------------- הנעילה ---------------- */

test('★ שנייה לפני הדדליין — פתוח. ברגע ובאחריו — נעול', () => {
  assert.equal(isSubmissionOpen(gw(), T - 1000), true);
  assert.equal(isSubmissionOpen(gw(), T), false, 'הרגע עצמו כבר נעול');
  assert.equal(isSubmissionOpen(gw(), T + 1), false);
});

test('★ סטטוס נעול חוסם גם כשהדדליין עוד לא הגיע', () => {
  // אדמין נעל מוקדם. השעון לא מבטל את ההחלטה שלו.
  assert.equal(isSubmissionOpen(gw({ status: GameweekStatus.Locked }), T - 3600_000), false);
  assert.equal(isSubmissionOpen(gw({ status: GameweekStatus.Draft }), T - 3600_000), false);
  assert.equal(isSubmissionOpen(gw({ status: GameweekStatus.Live }), T - 3600_000), false);
});

test('דדליין לא תקין נחשב נעול ולא פתוח לנצח', () => {
  assert.equal(isSubmissionOpen(gw({ deadlineAt: 'nonsense' }), T), false);
  assert.equal(msUntilDeadline(gw({ deadlineAt: 'nonsense' }), T), 0);
});

test('ספירה לאחור לא יורדת מתחת לאפס', () => {
  assert.equal(msUntilDeadline(gw(), T - 5000), 5000);
  assert.equal(msUntilDeadline(gw(), T + 99999), 0);
});

/* ---------------- מעבר אוטומטי ---------------- */

test('מחזור פתוח שעבר את הדדליין אמור להינעל', () => {
  assert.equal(dueStatus(gw(), T + 1), GameweekStatus.Locked);
  assert.equal(dueStatus(gw(), T - 1), null, 'עוד לא');
});

test('מחזור נעול שהגיע לבעיטת הפתיחה אמור לעבור ל-live', () => {
  const g = gw({ status: GameweekStatus.Locked, firstKickoffAt: '2026-08-29T18:30:00Z' });
  const kick = Date.parse('2026-08-29T18:30:00Z');
  assert.equal(dueStatus(g, kick - 1), null);
  assert.equal(dueStatus(g, kick), GameweekStatus.Live);
});

test('בלי בעיטת פתיחה אין מעבר אוטומטי ל-live', () => {
  assert.equal(dueStatus(gw({ status: GameweekStatus.Locked }), T + 99999999), null);
});

/* ---------------- נראוּת ---------------- */

test('תוצאות גלויות רק אחרי פרסום', () => {
  for (const s of ['draft', 'open', 'locked', 'live', 'scoring'] as const) {
    assert.equal(areResultsVisible(gw({ status: s })), false, s);
  }
  assert.equal(areResultsVisible(gw({ status: 'published' })), true);
  assert.equal(areResultsVisible(gw({ status: 'archived' })), true);
});

test('מחזור בהכנה מוסתר ממשתמשים', () => {
  assert.equal(isVisibleToUsers(gw({ status: GameweekStatus.Draft })), false);
  assert.equal(isVisibleToUsers(gw({ status: GameweekStatus.Open })), true);
});

/* ---------------- תצוגה ---------------- */

test('ספירה לאחור מחזירה ספרות בלבד', () => {
  assert.deepEqual(countdown(0), { clock: '00:00:00', days: 0, done: true });
  assert.deepEqual(countdown(-5), { clock: '00:00:00', days: 0, done: true });
  assert.equal(countdown(3661_000).clock, '01:01:01');
  assert.equal(countdown(90_000).clock, '00:01:30');
});

test('★ אין עברית בתוך המספר — הבאג שהפך "4ד 02:12" ל-"402:12 ד"', () => {
  const c = countdown(4 * 86400_000 + 2 * 3600_000);
  assert.match(c.clock, /^\d{2}:\d{2}:\d{2}$/, 'המחוגה חייבת להיות ספרות ונקודתיים בלבד');
  assert.equal(c.days, 4, 'הימים חוזרים כמספר נפרד');
});

test('תווית הימים בעברית תקינה', () => {
  assert.equal(daysLabel(0), '');
  assert.equal(daysLabel(1), 'עוד יום');
  assert.equal(daysLabel(2), 'עוד יומיים');
  assert.equal(daysLabel(5), 'עוד 5 ימים');
});

/* ---------------- התאמה בין הקוד ל-SQL ---------------- */

test('★ מפת המעברים ב-TS זהה לזו שב-SQL', async () => {
  // שתי רשימות שאמורות להיות זהות = חוב טכני. הבדיקה הזו היא
  // התשלום עליו: אם מישהו ישנה אחת ולא את השנייה, כאן זה ייפול.
  const fs = await import('node:fs/promises');
  const sql = await fs.readFile('db/05_gameweek_lock.sql', 'utf8');

  const expected: Array<[string, string[]]> = [
    ['draft', ['open']],
    ['open', ['locked', 'draft']],
    ['locked', ['live', 'open']],
    ['live', ['scoring']],
    ['scoring', ['published', 'live']],
    ['published', ['archived', 'scoring']],
  ];

  for (const [from, tos] of expected) {
    assert.deepEqual([...nextStatuses(from as never)], tos, `TS: ${from}`);
    const line = sql.split('\n').find((l) => l.includes(`WHEN '${from}'`));
    assert.ok(line, `SQL חסר מעבר עבור ${from}`);
    for (const to of tos) {
      assert.ok(line!.includes(`'${to}'`), `SQL: ${from} -> ${to} חסר`);
    }
  }
});
