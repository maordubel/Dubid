/**
 * tests/growth.test.ts — תוכנית השיווק הצולבת.
 *
 * שלוש תכונות נבדקות כאן, וכל אחת מהן היא כלל מוצר ולא פרט מימוש:
 *
 *   1. **דטרמיניזם.** אותו הקשר → אותו מסר, תמיד. בלי זה אי אפשר
 *      למדוד ואי אפשר לשחזר תלונה של משתמש.
 *   2. **תקרה ודחייה.** באנר שרודף הורג את שני המוצרים.
 *   3. **שיוך.** אופסיידס חייב לדעת מאיפה הגיע המשתמש — ובלי
 *      שום מזהה אישי בכתובת.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IMPRESSION_CAP, PROMOS, emptyFrequency, offsidesUrl, pickPromo,
  recordDismiss, recordImpression, rollGameweek, shouldShow,
  type GrowthContext,
} from '../src/lib/growth.ts';

const HOUR = 3600_000;

function ctx(over: Partial<GrowthContext> = {}): GrowthContext {
  return {
    submissionOpen: true,
    hasSubmitted: false,
    resultsPublished: false,
    msToKickoff: 72 * HOUR,
    ...over,
  };
}

/* ---------------- בחירת הרגע ---------------- */

test('★ אותו הקשר מחזיר תמיד את אותו מסר — אין אקראיות', () => {
  const c = ctx({ hasSubmitted: true });
  const first = pickPromo(c);
  for (let i = 0; i < 50; i++) {
    assert.equal(pickPromo(ctx({ hasSubmitted: true })).id, first.id);
  }
});

test('נעל הרכב וההגשות פתוחות → הלולאה הפתוחה', () => {
  assert.equal(pickPromo(ctx({ hasSubmitted: true })).id, 'just-locked');
});

test('לא הגיש והשריקה רחוקה → שקט', () => {
  assert.equal(pickPromo(ctx()).id, 'idle');
});

test('שעה לשריקה גובר על הכל חוץ מתוצאות', () => {
  assert.equal(pickPromo(ctx({ hasSubmitted: true, msToKickoff: HOUR })).id, 'kickoff-soon');
  // גם מי שלא הגיש — הוא ממילא הולך לצפות במשחק.
  assert.equal(pickPromo(ctx({ msToKickoff: HOUR })).id, 'kickoff-soon');
});

test('חלון השריקה נסגר אחרי שהמשחק התחיל', () => {
  // זמן שלילי = כבר שורקים. "עוד רגע שורקים" יהיה שקר.
  assert.notEqual(pickPromo(ctx({ msToKickoff: -HOUR })).id, 'kickoff-soon');
});

test('גבול החלון מדויק — שעתיים בדיוק עוד בפנים, רגע אחרי כבר לא', () => {
  assert.equal(pickPromo(ctx({ msToKickoff: 2 * HOUR })).id, 'kickoff-soon');
  assert.notEqual(pickPromo(ctx({ msToKickoff: 2 * HOUR + 1 })).id, 'kickoff-soon');
});

test('★ תוצאות גוברות על הכל — מה שקרה חזק ממה שיקרה', () => {
  const published = { resultsPublished: true, hasSubmitted: true, msToKickoff: HOUR };
  assert.equal(pickPromo(ctx({ ...published, rank: 1 })).id, 'champion');
  assert.equal(pickPromo(ctx({ ...published, rank: 2 })).id, 'beaten');
});

test('תוצאות בלי דירוג לא מתחזות לניצחון', () => {
  // אין `rank` = אין מה לומר על התוצאה. נופלים אחורה, לא ממציאים.
  const p = pickPromo(ctx({ resultsPublished: true, hasSubmitted: true }));
  assert.ok(p.id !== 'champion' && p.id !== 'beaten');
});

test('לכל מסר יש כותרת, גוף וקריאה לפעולה', () => {
  for (const [id, promo] of Object.entries(PROMOS)) {
    assert.equal(promo.id, id, 'המזהה במפתח ובערך חייב להיות זהה');
    assert.ok(promo.headline.length > 0 && promo.headline.length <= 44, id);
    assert.ok(promo.body.length > 0 && promo.body.length <= 90, `גוף ארוך מדי: ${id}`);
    assert.ok(promo.cta.length > 0 && promo.cta.length <= 20, id);
  }
});

/* ---------------- תדירות ---------------- */

test('★ דחייה עוצרת את הבאנר לכל המחזור', () => {
  let s = emptyFrequency(2);
  assert.ok(shouldShow(s, 'idle', 2));
  s = recordDismiss(s, 2);
  assert.ok(!shouldShow(s, 'idle', 2), 'נדחה — ולא חוזר');
  assert.ok(!shouldShow(s, 'champion', 2), 'הדחייה חלה על כל המסרים');
});

test('★ דחייה מתאפסת במחזור הבא — ולא הופכת לצמיתות', () => {
  const s = recordDismiss(emptyFrequency(2), 2);
  assert.ok(shouldShow(s, 'idle', 3), 'מחזור חדש, התחלה נקייה');
});

test('תקרת חשיפות לכל מסר', () => {
  let s = emptyFrequency(2);
  for (let i = 0; i < IMPRESSION_CAP; i++) {
    assert.ok(shouldShow(s, 'idle', 2), `חשיפה ${i + 1} עדיין מותרת`);
    s = recordImpression(s, 'idle', 2);
  }
  assert.ok(!shouldShow(s, 'idle', 2), 'התקרה נגמרה');
  // מסר אחר עדיין מותר — התקרה היא לכל וריאנט, לא לכל הבאנר.
  assert.ok(shouldShow(s, 'beaten', 2));
});

test('החלפת מחזור מאפסת את הספירה', () => {
  let s = emptyFrequency(2);
  for (let i = 0; i < IMPRESSION_CAP; i++) s = recordImpression(s, 'idle', 2);
  assert.ok(shouldShow(s, 'idle', 3));
  assert.equal(rollGameweek(s, 3).impressions.idle, undefined);
});

test('מצב תדירות לא משתנה במקום', () => {
  // שינוי במקום היה גורם ל-React לא לרנדר מחדש.
  const s = emptyFrequency(2);
  const next = recordImpression(s, 'idle', 2);
  assert.notEqual(s, next);
  assert.equal(s.impressions.idle, undefined, 'המקור לא נגע');
});

/* ---------------- שיוך ---------------- */

test('★ הקישור נושא שיוך מלא ובלי מזהה אישי', () => {
  const url = new URL(offsidesUrl('beaten', 'result', 7));
  assert.equal(url.searchParams.get('ref'), 'dubid');
  assert.equal(url.searchParams.get('src'), 'result');
  assert.equal(url.searchParams.get('v'), 'beaten');
  assert.equal(url.searchParams.get('gw'), '7');

  // שום דבר בכתובת לא מזהה משתמש.
  for (const [, value] of url.searchParams) {
    assert.ok(!/^[0-9a-f]{8}-/.test(value), `נראה כמו מזהה: ${value}`);
  }
});

test('הקישור מצביע על אופסיידס ולא על משהו אחר', () => {
  assert.equal(new URL(offsidesUrl('idle', 'lobby', 1)).host, 'offsides.dubelteam.com');
});
