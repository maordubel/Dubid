/**
 * scripts/design/build-logo.mjs — נגזרות הלוגו.
 *
 * מקור אחת ויחידה: `brand/source/dubid-logo-source.png` — הדיוקן
 * בקו אחד על נייר קרם, כפי שסופק.
 *
 * מכאן נגזר הכל. הרעיון: הרקע הקרם **אינו** חלק מהלוגו. אנחנו
 * מחלצים ממנו מסכת אלפא לפי כהות הפיקסל, ואז צובעים את הקו בצבע
 * המבוקש. כך אותו קובץ נותן גם קו קרם על כהה, גם זהב, וגם דיו על
 * נייר — בלי שלושה קבצים שמישהו יצטרך לסנכרן ביניהם ידנית.
 *
 * הרצה:  node scripts/design/build-logo.mjs
 */
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const SRC = `${ROOT}/brand/source/dubid-logo-source.png`;

/** צבעי הקו. שמות סמנטיים — לא "כתום"/"צהוב". */
const INKS = {
  gold:  [0xD8, 0xB2, 0x5C],   // הקו על משטח כהה — הצבע הראשי של המותג
  cream: [0xF3, 0xEA, 0xDA],   // קו ניטרלי, כשזהב מתחרה עם משהו אחר
  ink:   [0x14, 0x18, 0x1C],   // המקור, לשימוש על נייר בהיר
};

/**
 * ★ למה סף כפול ולא סף אחד.
 *
 * הרקע אינו קרם אחיד לגמרי — יש בו רעש סריקה של כמה יחידות.
 * סף יחיד או משאיר הילה מלוכלכת מסביב לקו, או אוכל את הקצה
 * המוחלק ומשאיר קו משונן. שני ספים נותנים מעבר רך: מעל `keep`
 * שקוף לגמרי, מתחת ל-`solid` אטום לגמרי, ובאמצע — ליניארי.
 */
const KEEP = 232;    // בהיר מזה = רקע
const SOLID = 120;   // כהה מזה = קו מלא

async function alphaMask() {
  const { data, info } = await sharp(SRC)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const n = info.width * info.height;
  const alpha = Buffer.alloc(n);
  for (let i = 0; i < n; i++) {
    const o = i * info.channels;
    // לומיננס תפיסתי. ממוצע פשוט היה הופך את העדשות הכחלחלות
    // לבהירות מדי ומחורר את המשקפיים.
    const lum = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
    alpha[i] = lum >= KEEP ? 0
      : lum <= SOLID ? 255
      : Math.round(((KEEP - lum) / (KEEP - SOLID)) * 255);
  }
  return { alpha, width: info.width, height: info.height };
}

async function tinted(mask, [r, g, b]) {
  const { alpha, width, height } = mask;
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = alpha[i];
  }
  return sharp(rgba, { raw: { width, height, channels: 4 } }).png();
}

async function out(path, buf) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buf);
  console.log('·', path.replace(ROOT + '/', ''), `${(buf.length / 1024).toFixed(0)}kb`);
}

const mask = await alphaMask();

/* ---- הלוגו המלא (דיוקן + חתימה + כדור) ---- */
for (const [name, rgb] of Object.entries(INKS)) {
  const img = await tinted(mask, rgb);
  await out(`${ROOT}/public/brand/dubid-logo-${name}.png`,
    await img.clone().resize({ width: 1000 }).toBuffer());
  await out(`${ROOT}/public/brand/dubid-logo-${name}@360.png`,
    await img.clone().resize({ width: 360 }).toBuffer());
}

/* ---- הסמל: הדיוקן בלבד, ריבועי ----
   החתימה והכדור נעלמים מתחת ל-64px. הדיוקן שורד. */
const PORTRAIT = { left: 40, top: 20, width: mask.width - 80, height: Math.round(mask.height * 0.70) };
for (const [name, rgb] of Object.entries(INKS)) {
  const img = (await tinted(mask, rgb)).extract(PORTRAIT);
  await out(`${ROOT}/public/brand/dubid-mark-${name}.png`,
    await img.clone().resize({ width: 512, height: 512, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer());
}

/* ---- אייקוני PWA: זהב על לילה, עם ריווח בטוח ---- */
const NIGHT = { r: 0x0D, g: 0x0B, b: 0x09, alpha: 1 };
const goldPortrait = (await tinted(mask, INKS.gold)).extract(PORTRAIT);

/**
 * ★ למה יש כאן חיזוק אלפא.
 *
 * הלוגו הוא קו בעובי ~4px על בד של 1254px. בהקטנה ל-32 הקו נופל
 * לחמישית פיקסל, ה-resampler ממצע אותו עם הרקע, והתוצאה היא כתם
 * חום. חיזוק האלפא מחזיר לקו נוכחות: כל פיקסל שקיבל שריד של קו
 * הופך לקו. מתחת ל-96px זה ההבדל בין סמל לכתם.
 */
async function boostAlpha(buf, gain) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 4) data[i] = Math.min(255, Math.round(data[i] * gain));
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

async function icon(size, pad) {
  const inner = Math.round(size * (1 - pad * 2));
  let art = await goldPortrait.clone()
    .resize({ width: inner, height: inner, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  if (size <= 96) art = await boostAlpha(art, size <= 40 ? 3.4 : 2.2);
  return sharp({ create: { width: size, height: size, channels: 4, background: NIGHT } })
    .composite([{ input: art, gravity: 'center' }])
    .png()
    .toBuffer();
}

await out(`${ROOT}/public/icons/seal-192.png`, await icon(192, 0.08));
await out(`${ROOT}/public/icons/seal-512.png`, await icon(512, 0.08));
// maskable: 20% ריווח בכל צד, כי אנדרואיד חותך עיגול
await out(`${ROOT}/public/icons/seal-maskable-512.png`, await icon(512, 0.20));
await out(`${ROOT}/public/icons/apple-touch-icon.png`, await icon(180, 0.10));
await out(`${ROOT}/public/icons/favicon-64.png`, await icon(64, 0.06));
await out(`${ROOT}/public/icons/favicon-32.png`, await icon(32, 0.04));

/* ---- favicon.svg: עוטף את ה-PNG כדי שקישור אחד יספיק ---- */
const fav = (await icon(128, 0.06)).toString('base64');
await out(`${ROOT}/public/favicon.svg`, Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">` +
  `<image href="data:image/png;base64,${fav}" width="128" height="128"/></svg>`,
));

/* ---- תאימות לאחור: הבאדג׳ הישן מצביע על הסמל החדש ---- */
await out(`${ROOT}/public/brand/dubid-badge.png`,
  await goldPortrait.clone().resize({ width: 240, height: 240, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer());
await out(`${ROOT}/public/brand/dubid-badge@1024.png`,
  await goldPortrait.clone().resize({ width: 1024, height: 1024, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer());

console.log('\nהלוגו נבנה מחדש מ-' + SRC.replace(ROOT + '/', ''));
