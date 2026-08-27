/**
 * tests/formation.test.ts — פריסת המגרש.
 *
 * ★ הבדיקה המרכזית כאן היא אי-חפיפה. היא רצה על **כל** מערך
 *   שהמוצר מכיר, בכל רוחב מסך שנתמך — כי הבאג המקורי היה בדיוק
 *   זה: מערך שנראה טוב בדסקטופ ונשבר ב-360 פיקסלים.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FORMATIONS_11, FORMATIONS_5, MIN_CARD, PITCH_RATIO, cardHeight, cardWidth,
  formationsFor, layoutFormation, minPitchWidth, parseFormation, positionCounts,
  ratioForFormation, hudCollides, hudWidth, HUD_W_PX,
} from '../src/lib/formation.ts';

/**
 * הרוחב המינימלי של מגרש שהמוצר מתחייב עליו לחלון התקציב.
 * ראו את הבדיקה בתחתית הקובץ — הוא צר יותר מכל טלפון בשוק.
 */
const MIN_PITCH_FOR_HUD = 260;

const ALL = [...FORMATIONS_11, ...FORMATIONS_5].map((f) => f.id);
/** רוחבי מסך אמיתיים, פחות ריפוד של 24 פיקסלים. */
const WIDTHS = [320, 360, 390, 414, 430, 768, 1024, 1440].map((w) => w - 24);

/* ---------------- פירוק ---------------- */

test('פירוק מערך תקין', () => {
  assert.deepEqual(parseFormation('4-3-3'), [4, 3, 3]);
  assert.deepEqual(parseFormation('4-2-3-1'), [4, 2, 3, 1]);
  assert.deepEqual(parseFormation('2-1-1'), [2, 1, 1]);
});

test('מערך לא תקין מוחזר כ-null ולא זורק', () => {
  for (const bad of ['', '4', 'abc', '4-3-x', '9-9-9', '4-0-3', '1-1-1-1-1-1']) {
    assert.equal(parseFormation(bad), null, bad);
    assert.equal(layoutFormation(bad), null, bad);
  }
});

/* ---------------- ספירת עמדות ---------------- */

test('ספירת העמדות תואמת את גודל ההרכב', () => {
  assert.deepEqual(positionCounts('4-3-3'), { GK: 1, DEF: 4, MID: 3, FWD: 3 });
  assert.deepEqual(positionCounts('4-2-3-1'), { GK: 1, DEF: 4, MID: 5, FWD: 1 });
  assert.deepEqual(positionCounts('2-1-1'), { GK: 1, DEF: 2, MID: 1, FWD: 1 });
  assert.deepEqual(positionCounts('1-2-1'), { GK: 1, DEF: 1, MID: 2, FWD: 1 });
});

test('כל מערך 11 מסתכם ב-11 שחקנים', () => {
  for (const f of FORMATIONS_11) {
    assert.equal(layoutFormation(f.id)!.size, 11, f.id);
  }
});

test('כל מערך 5 מסתכם ב-5 שחקנים', () => {
  for (const f of FORMATIONS_5) {
    assert.equal(layoutFormation(f.id)!.size, 5, f.id);
  }
});

/* ---------------- ★ אי-חפיפה ---------------- */

test('★ אין שני שחקנים באותו מקום, בשום מערך', () => {
  for (const id of ALL) {
    const seen = new Set<string>();
    for (const s of layoutFormation(id)!.slots) {
      const key = `${s.x.toFixed(2)}|${s.y.toFixed(2)}`;
      assert.ok(!seen.has(key), `${id}: שני שחקנים ב-${key}`);
      seen.add(key);
    }
  }
});

test('★ כרטיסים באותה שורה לא חופפים בשום רוחב נתמך', () => {
  for (const id of ALL) {
    const layout = layoutFormation(id)!;
    for (const pitch of WIDTHS) {
      if (pitch < minPitchWidth(layout.maxRow)) continue; // רוחב שלא נתמך, נבדק בנפרד
      const w = cardWidth(pitch, layout.maxRow, ratioForFormation(id));

      // מקבצים לפי שורה ובודקים מרחק בין מרכזים סמוכים
      const rows = new Map<number, number[]>();
      for (const s of layout.slots) {
        const arr = rows.get(s.y) ?? [];
        arr.push((s.x / 100) * pitch);
        rows.set(s.y, arr);
      }
      for (const [y, xs] of rows) {
        xs.sort((a, b) => a - b);
        for (let i = 1; i < xs.length; i++) {
          assert.ok(
            xs[i] - xs[i - 1] >= w,
            `${id} @${pitch}px שורה ${y}: מרווח ${(xs[i] - xs[i - 1]).toFixed(1)} < כרטיס ${w}`,
          );
        }
      }
    }
  }
});

test('★ אף שחקן לא חורג מגבולות המגרש', () => {
  for (const id of ALL) {
    const layout = layoutFormation(id)!;
    for (const pitch of WIDTHS) {
      if (pitch < minPitchWidth(layout.maxRow)) continue;
      const half = cardWidth(pitch, layout.maxRow, ratioForFormation(id)) / 2;
      for (const s of layout.slots) {
        const cx = (s.x / 100) * pitch;
        assert.ok(cx - half >= -1, `${id} @${pitch}: גולש מימין`);
        assert.ok(cx + half <= pitch + 1, `${id} @${pitch}: גולש משמאל`);
        assert.ok(s.y > 0 && s.y < 100, `${id}: y מחוץ לתחום`);
      }
    }
  }
});

/* ---------------- סדר וגיאומטריה ---------------- */

test('השוער תמיד למטה במרכז', () => {
  for (const id of ALL) {
    const gk = layoutFormation(id)!.slots.find((s) => s.position === 'GK')!;
    assert.equal(gk.x, 50, id);
    assert.ok(gk.y > 85, id);
  }
});

test('ההגנה נמוכה מההתקפה — בכל מערך', () => {
  for (const id of ALL) {
    const slots = layoutFormation(id)!.slots;
    const def = Math.max(...slots.filter((s) => s.position === 'DEF').map((s) => s.y));
    const fwd = Math.min(...slots.filter((s) => s.position === 'FWD').map((s) => s.y));
    assert.ok(def > fwd, `${id}: ההגנה (${def}) לא מאחורי ההתקפה (${fwd})`);
  }
});

test('שורה מרובת שחקנים פרושה סימטרית סביב המרכז', () => {
  const back = layoutFormation('4-3-3')!.slots.filter((s) => s.position === 'DEF');
  const xs = back.map((s) => s.x).sort((a, b) => a - b);
  assert.deepEqual(xs, [12.5, 37.5, 62.5, 87.5]);
  // סימטריה: הממוצע חייב להיות בדיוק במרכז
  assert.equal(xs.reduce((a, b) => a + b, 0) / xs.length, 50);
});

/* ---------------- גודל הכרטיס ---------------- */

test('★ הכרטיס אף פעם לא קטן מיעד המגע המינימלי', () => {
  for (const id of ALL) {
    const { maxRow } = layoutFormation(id)!;
    for (const pitch of WIDTHS) {
      assert.ok(cardWidth(pitch, maxRow) >= MIN_CARD, `${id} @${pitch}`);
    }
  }
});

test('הכרטיס גדל עם המסך אך נעצר בתקרה', () => {
  const { maxRow } = layoutFormation('4-3-3')!;
  assert.ok(cardWidth(296, maxRow) < cardWidth(744, maxRow));
  assert.equal(cardWidth(4000, maxRow), 76, 'תקרה — כרטיס ענק נראה מגוחך');
});

test('★ המערך הצפוף ביותר נכנס במסך הצר ביותר', () => {
  // 5-3-2 הוא המקרה הקשה: חמישה מגנים בשורה אחת.
  const worst = Math.max(...FORMATIONS_11.map((f) => layoutFormation(f.id)!.maxRow));
  assert.equal(worst, 5);
  assert.ok(
    minPitchWidth(worst) <= 320 - 24,
    `5 בשורה דורש ${minPitchWidth(worst)}px אבל יש רק ${320 - 24}px`,
  );
});

test('בורר המערכים מחזיר את הרשימה הנכונה לכל מצב', () => {
  assert.equal(formationsFor(5), FORMATIONS_5);
  assert.equal(formationsFor(11), FORMATIONS_11);
});

/* ---------------- ★ חפיפה אנכית ---------------- */

test('★ שורות לא חופפות אנכית — הבאג שדחף את השוער אל מחוץ למגרש', () => {
  for (const id of ALL) {
    const layout = layoutFormation(id)!;
    for (const pitchW of WIDTHS) {
      if (pitchW < minPitchWidth(layout.maxRow)) continue;
      const pitchH = pitchW * ratioForFormation(id);
      const ch = cardHeight(cardWidth(pitchW, layout.maxRow, ratioForFormation(id)));

      const ys = [...new Set(layout.slots.map((s) => s.y))].sort((a, b) => a - b);
      for (let i = 1; i < ys.length; i++) {
        const gap = ((ys[i] - ys[i - 1]) / 100) * pitchH;
        assert.ok(
          gap >= ch,
          `${id} @${pitchW}px: מרווח אנכי ${gap.toFixed(0)} < גובה כרטיס ${ch}`,
        );
      }
    }
  }
});

test('★ אף כרטיס לא חורג מהמגרש אנכית — כולל השוער', () => {
  for (const id of ALL) {
    const layout = layoutFormation(id)!;
    for (const pitchW of WIDTHS) {
      if (pitchW < minPitchWidth(layout.maxRow)) continue;
      const pitchH = pitchW * ratioForFormation(id);
      const half = cardHeight(cardWidth(pitchW, layout.maxRow, ratioForFormation(id))) / 2;
      for (const s of layout.slots) {
        const cy = (s.y / 100) * pitchH;
        assert.ok(cy - half >= -1, `${id} @${pitchW}: ${s.position} גולש מלמעלה`);
        assert.ok(cy + half <= pitchH + 1, `${id} @${pitchW}: ${s.position} גולש מלמטה`);
      }
    }
  }
});

test('★ ה-clamp ב-CSS זהה ל-cardWidth ב-TypeScript', async () => {
  // שני מקומות שמחשבים גודל כרטיס = שני גדלים שיכולים להיפרד,
  // והרינדור יסטה ממה שהבדיקות מוכיחות. הבדיקה הזו סוגרת את הפער.
  const fs = await import('node:fs/promises');
  const tsx = await fs.readFile('src/components/Pitch.tsx', 'utf8');

  assert.ok(tsx.includes('calc(100% / var(--max-row) - ${GUTTER_PX}px)'),
    'החסם האופקי ב-CSS לא משתמש ב-GUTTER_PX המשותף');
  assert.ok(tsx.includes("'calc(100cqw * var(--vcap))'"),
    'החסם האנכי ב-CSS לא קורא את --vcap');
  assert.ok(tsx.includes("'--vcap': verticalCap(r).toFixed(4)"),
    '--vcap לא נגזר מ-verticalCap — ה-CSS וה-TS ייפרדו');
  assert.ok(tsx.includes(`clamp(${'${MIN_CARD}'}px`), 'ה-clamp לא משתמש ב-MIN_CARD המשותף');
  assert.ok(tsx.includes('[container-type:inline-size]'),
    '100cqw לא יעבוד בלי container-type על המגרש');
});

test('מערך קצר מקבל מגרש נמוך יותר', () => {
  assert.equal(ratioForFormation('4-2-3-1'), PITCH_RATIO, 'חמש שורות — מגרש מלא');
  assert.ok(ratioForFormation('2-1-1') < PITCH_RATIO, 'קט-רגל על מגרש קטן');
  assert.ok(ratioForFormation('4-3-3') < PITCH_RATIO);
  assert.equal(ratioForFormation('לא-מערך'), PITCH_RATIO, 'ברירת מחדל בטוחה');
});

/* ---------------- ★ מיקום פיזי מול לוגי ---------------- */

test('★ המשבצת ממוקמת ב-left פיזי — הבאג שהזיז כל שחקן במגרש', async () => {
  /*
   * הבאג: `insetInlineStart` ב-RTL עוגן את הכרטיס מהצד הימני,
   * בעוד `-translate-x-1/2` הזיז אותו שמאלה. השניים לא ביטלו זה
   * את זה, וכל כרטיס ישב במרחק של רוחב כרטיס שלם מהמקום שלו.
   *
   * `slot.x` הוא גאומטריה על המגרש, לא כיוון קריאה. גאומטריה
   * לא מתהפכת עם שפת הממשק.
   */
  const fs = await import('node:fs/promises');
  const tsx = await fs.readFile('src/components/Pitch.tsx', 'utf8');
  const slot = tsx.slice(tsx.indexOf('function PlayerSlot'));

  assert.ok(
    slot.includes('left: `${slot.x}%`'),
    'המשבצת חייבת להשתמש ב-left פיזי',
  );
  assert.ok(
    !slot.includes('insetInlineStart'),
    'inset-inline-start במשבצת מחזיר את הבאג',
  );
  assert.ok(
    slot.includes('-translate-x-1/2'),
    'בלי המירכוז, x הוא הפינה ולא המרכז',
  );
});

test('★ אין מירכוז לוגי עם transform בשום קומפוננטה', async () => {
  // אותו באג הופיע גם בזוהר שמאחורי הבאדג׳ בלובי.
  // `start-*` יחד עם `-translate-x-*` הוא תמיד מירכוז שבור ב-RTL.
  const fs = await import('node:fs/promises');
  const files = ['src/components/Pitch.tsx', 'src/components/Lobby.tsx'];
  for (const f of files) {
    const src = await fs.readFile(f, 'utf8');
    for (const line of src.split('\n')) {
      if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;
      const broken = /\bstart-(1\/2|\[)/.test(line) && /-translate-x-/.test(line);
      assert.ok(!broken, `${f}: מירכוז לוגי עם transform — ${line.trim()}`);
    }
  }
});

/* ================================================================== */
/* חלון התקציב המרחף                                                   */
/* ================================================================== */

/**
 * ★ למה זו בדיקה ולא "בדקתי במסך שלי".
 *
 * חלון התקציב מרחף מעל המגרש בפינה התחתונה. אם הוא נוגע בכרטיס
 * שחקן הוא מסתיר בדיוק את הבחירה שהמשתמש עשה — והמקום המסוכן
 * הוא השוער ושורת ההגנה, שיושבים נמוך.
 *
 * רוחב המגרש נגזר מהגובה הפנוי, שמשתנה עם גובה המכשיר, עם סרגל
 * הכתובות של הדפדפן ועם המערך. צילום מסך אחד לא מוכיח כלום.
 *
 * הגרסה הראשונה של החלון (126×74) נגעה בכרטיס בכל מגרש צר
 * מ-400 פיקסלים — כלומר כמעט בכל טלפון. הבדיקה הזו היא שמצאה
 * את זה, לא העין.
 */
test('חלון התקציב לא נוגע באף כרטיס, בשום מערך ובשום רוחב', () => {
  const failures: string[] = [];

  for (const size of [5, 11]) {
    for (const option of formationsFor(size)) {
      const layout = layoutFormation(option.id);
      assert.ok(layout, option.id);
      const floor = Math.max(MIN_PITCH_FOR_HUD, minPitchWidth(layout.maxRow));

      for (let w = floor; w <= 900; w += 1) {
        if (hudCollides(option.id, w)) { failures.push(`${option.id}@${w}`); break; }
      }
    }
  }

  assert.deepEqual(failures, []);
});

test('חלון התקציב תופס פחות משליש מרוחב המגרש', () => {
  /* אם מישהו יגדיל אותו "רק קצת", זה נשבר לפני שזה מגיע למסך. */
  for (const w of [260, 320, 400, 600, 900]) {
    assert.ok(hudWidth(w) / w <= 0.34, `רוחב יחסי ב-${w}`);
  }
  assert.equal(hudWidth(900), HUD_W_PX, 'במסך רחב החלון נעצר בגודל הקבוע');
});

test('הרצפה הנתמכת אינה מכשיר אמיתי', () => {
  /* ★ התיעוד של הרצפה, כדי שלא ייראה כמו מספר שנבחר בשרירות:
     מגרש של 260 פיקסלים מתקבל במכשיר צר מ-280 — צר יותר מכל
     טלפון שנמכר. מתחת לזה גם כרטיסי השחקנים עצמם כבר לא
     נכנסים (`minPitchWidth`). */
  assert.ok(MIN_PITCH_FOR_HUD >= 252);
  assert.ok(MIN_PITCH_FOR_HUD <= 280);
});
