/**
 * scripts/design/build-logo-layers.mjs — הלוגו, בשלוש שכבות.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ למה לחתוך לוגו שלם לשלושה חלקים
 * ═══════════════════════════════════════════════════════════════
 *
 * הבקשה הייתה שהלוגו ייראה **מצויר** — שהקו יופיע כאילו יד
 * מציירת אותו, לא שהתמונה תדהה פנימה.
 *
 * הדרך הקנונית לזה היא `stroke-dashoffset` על נתיבי SVG. אין לנו
 * נתיבים: הלוגו הוא סריקה של ציור בקו אחד, כלומר פיקסלים. תרגום
 * שלו ל-SVG (potrace) היה מייצר אלפי נתיבים קטנים, קובץ של
 * מאות קילובייטים, וקו שנראה מרוצף — יקר יותר, ופחות דומה למקור.
 *
 * ★ מה כן: לחשוף את הפיקסלים לפי **סדר הציור האמיתי**.
 *
 * הציור נבנה בשלושה מהלכים, וכל אחד מהם מתגלה אחרת:
 *
 *   1. הטבעת והדיוקן  — היד סובבת סביב המעגל       (חשיפה מעגלית)
 *   2. החתימה Dubid   — היד כותבת משמאל לימין      (מגב אופקי)
 *   3. הכדור והקווים  — חותמת אחת בסוף              (הופעה)
 *
 * ההפרדה לשלושה קבצים היא מה שמאפשר לכל מהלך תזמון ומסכה משלו.
 * זה עולה ~30kb לכל וריאנט, ורץ כולו על ה-GPU: `mask-image`
 * ו-`transform` בלבד, בלי JavaScript בלולאה ובלי ציור מחדש.
 *
 * ★ נקודות החיתוך אינן מוקלדות
 *
 * הן נמדדות מצפיפות הפיקסלים בכל שורה: בין המהלכים יש רווח לבן,
 * והוא נראה בפרופיל כשקע. מספרים קשיחים היו נשברים ביום שבו
 * הלוגו יצויר מחדש בפרופורציה אחרת.
 *
 * הרצה:  node scripts/design/build-logo-layers.mjs
 * דורש:  שהנגזרות הרגילות כבר קיימות (build-logo.mjs)
 */
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = `${ROOT}/public/brand`;

const VARIANTS = ['gold', 'cream', 'ink'];

/** מתחת לזה שורה נחשבת ריקה. רעש קצה מוחלק לא נספר. */
const INK_MIN_ALPHA = 16;

/**
 * מוצא את שני השקעים בפרופיל הצפיפות.
 *
 * ★ חיפוש בחלון ולא מינימום גלובלי: המינימום הגלובלי הוא תמיד
 *   השוליים הריקים למעלה ולמטה. אנחנו רוצים את הרווח שבין
 *   הדיוקן לחתימה, והוא נמצא בערך ב-70%–75% מהגובה, ואת זה
 *   שבין החתימה לכדור, בערך ב-86%–90%.
 */
function findGaps(rows, h) {
  const gapIn = (from, to) => {
    let best = from, bestVal = Infinity;
    for (let y = from; y < to; y++) {
      if (rows[y] < bestVal) { bestVal = rows[y]; best = y; }
    }
    return best;
  };
  return [
    gapIn(Math.round(h * 0.66), Math.round(h * 0.78)),
    gapIn(Math.round(h * 0.83), Math.round(h * 0.92)),
  ];
}

async function layersFor(variant) {
  const src = `${OUT}/dubid-logo-${variant}.png`;
  const img = sharp(src);
  const { width: w, height: h } = await img.metadata();

  const { data } = await img.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const rows = new Array(h).fill(0);
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > INK_MIN_ALPHA) n++;
    rows[y] = n;
  }

  const [cut1, cut2] = findGaps(rows, h);

  /* ★ כל שכבה נשארת בגודל הקנבס המלא, עם שקיפות מסביב.
     חיתוך אמיתי היה מחייב כל שכבה למיקום משלה ב-CSS; ככה
     שלושתן פשוט מונחות זו על זו ב-`inset-0`, וההרכבה נכונה
     בהגדרה בכל גודל. */
  /* ★ קריאה אחת ל-`composite` עם שני שלבים, ולא שתי קריאות.
     ב-sharp, `.composite()` שנייה **מחליפה** את הראשונה ולא
     מוסיפה לה — התוצאה הייתה שלוש שכבות זהות וריקות, כולן
     באותו גודל בייטים בדיוק. זה מה שהסגיר את זה. */
  const band = (top, bottom) =>
    sharp({
      create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        { input: src, top: 0, left: 0, blend: 'over' },
        {
          // מסכה: רק הרצועה המבוקשת שורדת.
          input: Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
            `<rect x="0" y="${top}" width="${w}" height="${bottom - top}" fill="#fff"/></svg>`,
          ),
          blend: 'dest-in',
        },
      ])
      .png({ compressionLevel: 9 });

  const parts = [
    ['l1', 0, cut1],        // טבעת + דיוקן
    ['l2', cut1, cut2],     // החתימה
    ['l3', cut2, h],        // כדור + קווים
  ];

  for (const [name, top, bottom] of parts) {
    const buf = await band(top, bottom).toBuffer();
    await writeFile(`${OUT}/dubid-logo-${variant}-${name}.png`, buf);
  }

  return { variant, w, h, cut1, cut2 };
}

const report = [];
for (const v of VARIANTS) report.push(await layersFor(v));

console.log('שכבות הלוגו נבנו:');
for (const r of report) {
  console.log(`  ${r.variant.padEnd(6)} ${r.w}×${r.h}  חיתוך ב-${r.cut1} / ${r.cut2}`);
}

/* ★ בדיקת שפיות: אם שני החיתוכים זהים או צמודים, הפרופיל לא
   נמצא — כנראה הלוגו הוחלף. עדיף להיכשל רועש מלהוציא שכבה ריקה. */
for (const r of report) {
  if (r.cut2 - r.cut1 < r.h * 0.04) {
    console.error(`  ⚠  ${r.variant}: הרצועות צמודות מדי — בדקו את הלוגו`);
    process.exitCode = 1;
  }
}
