/**
 * tests/pass.test.ts — כרטיס המנוי, וההחלטה מתי להציע אותו.
 *
 * ★ שלוש קטגוריות של באגים נשמרות כאן:
 *   · הצעה שקופצת ברגע הלא נכון (או שלא קופצת בנכון)
 *   · מפתח שדולף לשרת דרך הכתובת
 *   · ולידציה של מייל שנפרדת מזו של המסד
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shouldOfferPass, shouldNudge, PASS_OFFERED_KEY, NUDGE_DISMISS_KEY }
  from '../src/lib/nudge.ts';
import { emailLooksValid } from '../src/lib/leads.ts';

/* ================================================================== */
/* מתי מציעים את הכרטיס                                                */
/* ================================================================== */

const base = { isGuest: true, hasSubmitted: true, offeredBefore: false, hasPass: false };

test('★★ ההצעה באה רק אחרי שיש מה לאבד', () => {
  /*
   * ★ הבאג שזה מונע.
   *
   * מסך מלא שקופץ למי שנכנס לפני שנייה הוא מס כניסה — בדיוק
   * מה שהמוצר החליט לא לגבות. אותו מסך אחרי הגשה מדבר על משהו
   * שהמשתמש בנה, והוא כבר מרגיש אותו כשלו.
   */
  assert.equal(shouldOfferPass({ ...base, hasSubmitted: false }), false);
  assert.equal(shouldOfferPass(base), true);
});

test('★ משתמש רשום לא מקבל הצעה לכרטיס', () => {
  /* יש לו מייל להיכנס איתו. כרטיס אצלו הוא פתרון לבעיה שאין לו,
     והוא נקרא כרעש. */
  assert.equal(shouldOfferPass({ ...base, isGuest: false }), false);
});

test('★★ פעם אחת, ולא פעם במחזור', () => {
  /*
   * ★ ההבדל מ-`shouldNudge` הוא מהותי.
   *
   * רצועת ההרשמה יושבת בתוך הדף ואפשר לגלול מעליה, ולכן מותר
   * לה לחזור כל מחזור. כרטיס המנוי הוא **מסך מלא שקופץ מעצמו**
   * — הוא חוסם רגע. מסך כזה שחוזר כל שבוע נקרא כהטרדה, וגם
   * ההצעה עצמה מפסידה.
   */
  assert.equal(shouldOfferPass({ ...base, offeredBefore: true }), false);
});

test('★ מי שכבר מחזיק מפתח לא מקבל הצעה אוטומטית', () => {
  /*
   * ★★ וזה לא נימוס — זה מניעת נזק.
   *
   * הנפקת מפתח **מבטלת את הקודם** (מפתח פעיל אחד למשתמש).
   * הצעה אוטומטית למי שכבר שמר כרטיס בגלריה הייתה הורגת בשקט
   * בדיוק את התמונה שאמרנו לו לשמור.
   */
  assert.equal(shouldOfferPass({ ...base, hasPass: true }), false);
});

test('שני המפתחות בזיכרון המכשיר נפרדים', () => {
  /* מפתח משותף היה גורם לסגירת הרצועה להשתיק גם את הכרטיס. */
  assert.notEqual(PASS_OFFERED_KEY, NUDGE_DISMISS_KEY);
  assert.match(PASS_OFFERED_KEY, /^dubid\./);
});

test('הרצועה והכרטיס לא מתנגשים באותו רגע', () => {
  /* שניהם נכונים אחרי הגשה. הכרטיס הוא מסך, הרצועה היא שורה
     בדף — ולכן שניהם יכולים להיות פעילים בלי להתחרות. */
  const nudge = shouldNudge({
    isGuest: true, hasSubmitted: true, published: false,
    gameweekNumber: 2, dismissedForGameweek: null,
  });
  assert.equal(nudge, true);
  assert.equal(shouldOfferPass(base), true);
});

/* ================================================================== */
/* ולידציית המייל                                                      */
/* ================================================================== */

test('★ ולידציית המייל זהה לזו שבמסד', () => {
  /*
   * ★ הבאג: טופס מרשה, שרת דוחה.
   *
   * ה-CHECK במסד הוא `^[^@\s]+@[^@\s]+\.[^@\s]+$`. טופס עם כלל
   * רופף יותר מייצר שגיאת שרת שנראית כמו תקלה שלנו — והמשתמש
   * מוותר במקום לתקן תו אחד.
   */
  for (const ok of ['a@b.co', 'maor.dubel@dubelteam.com', 'x+tag@mail.co.il']) {
    assert.equal(emailLooksValid(ok), true, ok);
  }
  for (const bad of ['', 'a', 'a@b', 'a b@c.com', '@b.co', 'a@.co', 'a@b.']) {
    assert.equal(emailLooksValid(bad), false, bad);
  }
});

test('רווחים מסביב לא פוסלים כתובת תקינה', () => {
  assert.equal(emailLooksValid('  maor@dubelteam.com  '), true);
});

/* ================================================================== */
/* הקישור — ואיפה המפתח יושב בתוכו                                     */
/* ================================================================== */

test('★★★ המפתח יושב ב-fragment ולא ב-query', async () => {
  /*
   * ★ ההבדל בין `#k=` לבין `?k=` הוא ההבדל בין מפתח פרטי לבין
   *   מפתח שעובר בשרתים.
   *
   * fragment **לא נשלח לשרת**. הוא לא מופיע בלוגים של ה-CDN,
   * לא ב-`Referer` כשהמשתמש לוחץ משם על קישור חיצוני, ולא בשום
   * שכבת ניטור שיושבת בדרך.
   *
   * המשתמש שולח את הקישור הזה לעצמו בוואטסאפ. `?k=` היה אומר
   * שכל שרת שהקישור עובר דרכו רואה מפתח כניסה מלא לחשבון.
   */
  const { passLink } = await import('../src/lib/identity.ts');
  const url = passLink('AB34CD67KM');

  assert.ok(url.includes('#k='), `אין fragment: ${url}`);
  assert.ok(!url.includes('?k='), `המפתח ב-query — דולף לשרת: ${url}`);

  const u = new URL(url);
  assert.equal(u.search, '', 'אסור ל-query string להכיל כלום');
  assert.equal(u.hash, '#k=AB34CD67KM');
});

test('★ מקפים נשלפים מהמפתח לפני שהוא נכנס לקישור', async () => {
  /* הכרטיס מציג `AB34-CD67-KM` כי ככה אפשר לקרוא אותו. השרת
     מקבל את הצורה המנורמלת — אחרת המפתח שהדפסנו לא עובד. */
  const { passLink } = await import('../src/lib/identity.ts');
  assert.equal(new URL(passLink('AB34-CD67-KM')).hash, '#k=AB34CD67KM');
});

test('★ הודעת הוואטסאפ כתובה אל עצמי, והקישור אחרון', async () => {
  const { buildPassMessage } = await import('../src/lib/passCard.ts');
  const msg = buildPassMessage({
    pretty: 'AB34-CD67-KM',
    link: 'https://dubid.dubelteam.com/#k=AB34CD67KM',
    userName: 'מאור',
    issuedLabel: 'הונפק 28.08.2026',
    urlLabel: 'DUBID.DUBELTEAM.COM',
  });

  assert.ok(msg.includes('AB34-CD67-KM'), 'המפתח חייב להופיע גם כטקסט');
  assert.ok(msg.includes('מאור'), 'ההודעה צריכה לזהות את הבעלים');
  /* ★ הקישור אחרון ובשורה נפרדת: ככה וואטסאפ בונה תצוגה מקדימה,
     וככה ההודעה נמצאת בחיפוש. */
  assert.ok(msg.trimEnd().endsWith('https://dubid.dubelteam.com/#k=AB34CD67KM'));
});

test('★★★ הקישור של הכרטיס נכנס ל-QR ברמת תיקון גבוהה', async () => {
  /*
   * ★ הבאג שזה תופס.
   *
   * `encodeQr` בוחר גרסה לפי אורך הקלט, וזורק כשאין קיבולת.
   * אם הקידוד נכשל — הכרטיס עדיין נראה מושלם, פשוט בלי ריבוע.
   * המשתמש שומר תמונה, ומגלה חודש אחר כך שאין מה לסרוק.
   *
   * ★ ורמת 'Q' ולא 'L': הכרטיס עובר בוואטסאפ, נדחס, ולפעמים
   *   מצולם מהמסך. תיקון נמוך שורד את המסך ולא את הצילום.
   *
   * (הקריאה ההפוכה עצמה נבדקת ב-`tests/qr.test.ts`, שם יושב
   *  המפענח — אותה מחרוזת בדיוק נמצאת שם ברשימה.)
   */
  const { encodeQr } = await import('../src/lib/qr.ts');
  const { passLink } = await import('../src/lib/identity.ts');

  const qr = encodeQr(passLink('K7M49XQ2BD'), 'Q');
  assert.ok(qr.size >= 21 && qr.size <= 57, `גודל חריג: ${qr.size}`);
});

test('★ גם מפתח עם מקפים מייצר QR תקין', async () => {
  const { encodeQr } = await import('../src/lib/qr.ts');
  const { passLink } = await import('../src/lib/identity.ts');
  assert.ok(encodeQr(passLink('K7M4-9XQ2-BD'), 'Q').size >= 21);
});
