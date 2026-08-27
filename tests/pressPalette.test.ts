/**
 * טסטים ל-`pressPalette` — השומר על כך ששני המסכים לא ייפרדו.
 *
 * ★ מה נשמר כאן
 *
 * כרטיס השיתוף (`lib/revealCard.ts`, קנבס) והמגרש בבחירת ההרכב
 * (`components/Pitch.tsx`, CSS ו-SVG) מציירים את **אותו** דשא
 * מודפס בשני מנועים שונים.
 *
 * זה בדיוק החיבור שהמוצר בנוי עליו: מי שבנה הרכב וקיבל גזיר
 * עיתון צריך לראות שזה אותו דבר. שני עותקים של אותו ירוק היו
 * נפרדים ביום שמישהו יכהה אחד מהם — ואף בדיקה לא קוראת תמונות,
 * ולכן זה היה חי לנצח.
 *
 * הבדיקה לא משווה פיקסלים. היא אוסרת על **ערך צבע כתוב ביד**
 * בשני הקבצים האלה, וזה מספיק: אי אפשר לשנות ירוק אחד בלי
 * לשנות את השני, כי יש רק אחד.
 *
 *   node --experimental-strip-types --test tests/pressPalette.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { PRESS } from '../src/lib/pressPalette.ts';

const HEX = /#[0-9a-fA-F]{3,8}\b/g;

function hexesIn(path: string): Set<string> {
  const src = readFileSync(path, 'utf8');
  /* מתעלמים מהערות: שם מותר לצטט ערך כדי להסביר החלטה. */
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  return new Set((code.match(HEX) ?? []).map((h) => h.toLowerCase()));
}

/**
 * ★ הכלל: **אף ערך צבע לא מופיע בשני הקבצים.**
 *
 * זו הניסוח המדויק של מה שאנחנו מפחדים ממנו — שאותו צבע יהיה
 * כתוב פעמיים ויום אחד ישתנה רק במקום אחד. צבע שמשמש את שני
 * המנועים חייב לבוא מ-`pressPalette`; צבע שמשמש רק אחד מהם
 * (גוון עור של הדמות המצוירת, למשל) מותר לו להישאר במקומו.
 *
 * הבדיקה מצאה כך את `#9aa39a` — חוטי רשת השער, שהיו כתובים
 * ביד בשני הקבצים.
 */
test('אין ערך צבע שכתוב ביד בשני המנועים', () => {
  const card = hexesIn('src/lib/revealCard.ts');
  const pitch = hexesIn('src/components/Pitch.tsx');
  const shared = [...card].filter((h) => pitch.has(h));
  assert.deepEqual(
    shared, [],
    `הצבעים האלה חוזרים בשני הקבצים וחייבים לעבור ל-lib/pressPalette.ts: ${shared.join(', ')}`,
  );
});

test('הפלטה מכילה את כל מה ששני המנועים צורכים', () => {
  for (const key of [
    'paper', 'card', 'ink', 'red', 'redDeep',
    'grass', 'grassDark', 'dot', 'line', 'halo', 'onGrass', 'net', 'netLine', 'mark',
  ] as const) {
    assert.ok(PRESS[key], `חסר ${key}`);
  }
});

test('צבעי הפלטה תקינים כערכי CSS', () => {
  for (const [key, value] of Object.entries(PRESS)) {
    assert.match(
      value, /^(#[0-9A-Fa-f]{6}|rgba?\([\d.,\s]+\))$/,
      `${key} = ${value}`,
    );
  }
});

test('הדשא הכהה כהה מהדשא, וקו המגרש בהיר משניהם', () => {
  /* ★ לא קפריזה: אם מישהו יחליף בין השניים, פסי הכיסוח יתהפכו
     והמגרש ייראה כמו נגטיב — בשני המנועים בבת אחת. */
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  };
  assert.ok(lum(PRESS.grassDark) < lum(PRESS.grass), 'grassDark חייב להיות כהה יותר');
  assert.ok(lum(PRESS.line) > lum(PRESS.grass), 'קו המגרש חייב להיות בהיר מהדשא');
  assert.ok(lum(PRESS.dot) < lum(PRESS.grassDark), 'נקודת ההלפטון חייבת להיות הכהה מכולן');
  assert.ok(lum(PRESS.ink) < 60, 'הדיו חייב להיות כהה');
  assert.ok(lum(PRESS.paper) > 200, 'הנייר חייב להיות בהיר');
});
