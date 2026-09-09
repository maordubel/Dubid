import * as THREE from 'three'

import { CITY_DEPTH, type CityDepth } from '../generated/cityDepth'

/**
 * לעמוד בתוך התמונה — הפנורמות שמאור שלח ב-7.9.2026, כמו שהן.
 *
 * הן לא רקעים רחבים. הכביש בתחתיתן מתעקל, וזאת החתימה של **הטלה גלילית**: הצלם הסתובב
 * סביב עצמו, וקו ישר של מדרכה נמתח סביבו לקשת. תמונה כזאת היא לא ציור שמסתכלים עליו — היא
 * חלל שעומדים במרכזו. וזה בדיוק מה שהתבקש: לא "רקע יפה", אלא להסתובב בצומת ולראות מה יש
 * מסביב.
 *
 * הגיאומטריה, ובלי אף פיקסל מומצא:
 *
 * • **הגליל.** בהטלה גלילית `x` הוא זווית האופק באופן ליניארי, ו-`y` הוא הגובה על הגליל
 *   באופן ליניארי (`h = R·tan ε`, ו-`tan ε` הוא בדיוק מה שהפיקסל מודד). לכן גליל רגיל עם
 *   מיפוי UV רגיל הוא ההצגה **המדויקת** של התמונה, לא קירוב שלה. אין כאן עיוות שצריך לתקן.
 *
 * • **הרצפה.** כל פיקסל מתחת לקו האופק הוא נקודה על הכביש במרחק `r = eye / tan|ε|` ובזווית
 *   `θ`. אפשר להפוך את זה: לכל נקודה על מישור הרצפה בעולם, לחשב לאיזה פיקסל בפנורמה היא
 *   שייכת. זה מה שה-shader עושה — הוא לא מצייר רצפה, הוא **קורא** את הרצפה שכבר צולמה.
 *   התוצאה: המרצפות זורמות נכון מתחת לרגליים כשהולכים, כי הן במקום האמיתי שלהן בעולם.
 *
 * • **איפה הם נפגשים.** הקצה התחתון של הפנורמה הוא הקרן אל הכביש במרחק
 *   `r₀ = eye·aspect / (hFov·(1−horizon))` — בערך שישה מטרים. מעבר לזה הגליל; מתחתיו
 *   הדיסקה. הם נפגשים בדיוק, כי שניהם נגזרים מאותה קרן.
 *
 * מה שאין: המטרים האחרונים מתחת לרגליים. הצלם עמד שם, אז הפנורמה לא צילמה אותם, ולכן
 * הרצועה התחתונה נמשכת פנימה (`clamp`) — אותה החלטה בדיוק שכבר התקבלה ב-
 * `finish-backdrops.py` לכל רקע אחר במשחק. ומה שעוד אין: אנשים ועמודים שעומדים על הכביש
 * נמרחים לתוך הרצפה מתחת לנקודת המגע שלהם, כי לתמונה שטוחה אין דרך לדעת שהם עומדים. הפתרון
 * לזה הוא לחתוך אותם ולהחזיר כדמויות, וזה שלב 4 בתדריך, לא כאן.
 */

export type PanoSpec = {
  /** מפתח התמונה תחת `/life/art` */
  key: string
  /** שם המקום, כמו שאומרים אותו — זה מה שמופיע בבורר המקומות */
  nameHe: string
  /** רוחב חלקי גובה של קובץ התמונה */
  aspect: number
  /** קו האופק כשבר מהגובה, מלמעלה — נמדד על התמונה */
  horizon: number
  /**
   * שדה הראייה האופקי, במעלות. נגזר משתי נקודות המגוז של שני הרחובות הניצבים בצומת:
   * המרחק ביניהן על התמונה הוא בדיוק 90°.
   */
  hFovDeg: number
  /** גובה העין מעל הרצפה, במטרים */
  eye: number
  /**
   * כמה רחוק מנקודת הצילום מותר ללכת. חדר הוא לא רחוב: בשדרה אפשר עשרה מטר ובחדר שני
   * צעדים, כי הקירות בשלושה מטר וכל סנטימטר של תזוזה נראה עליהם.
   */
  walk?: number
  /**
   * צבע הכביש ממש מתחת לרגליים, כשלושה בייטים — **החציון הנמדד** של הרצועה התחתונה בתמונה
   * עצמה. משמש כרשת ביטחון בלבד, למקרה שאין מרצף.
   */
  nearRgb: [number, number, number]
  /**
   * המרצף המיושר — אותה רצפה, מסובבת למבט מלמעלה על ידי
   * `scripts/life/rectify-ground-2026-09-07.py`, ובקנה מידה של מטרים. הוא זה שמכסה את
   * המרחק הקצר, שבו הקרן משיקה לרצפה וההיטל מהפנורמה מותח חמישה פיקסלים על עשרה מטר.
   */
  tile?: { key: string; wide: number; deep: number }
  /**
   * איזו הטלה. שתי משפחות של תמונות נכנסות למשחק, והן לא אותו דבר:
   *
   * • `'cyl'` — פנורמה גלילית. הצלם הסתובב סביב עצמו, ולכן `x` הוא הזווית **באופן
   *   ליניארי**, וקו ישר של מדרכה נמתח בה לקשת. זאת ברירת המחדל, וכל התמונות שהגיעו
   *   עד 7.9 הן כאלה.
   *
   * • `'rect'` — תצלום רגיל. קו ישר נשאר ישר, ולכן `x` הוא `tan θ` ולא `θ`, והסקאלה
   *   האנכית נמתחת ב-`1/cos θ`. חמש תחנות חזית בלומפילד הן כאלה: קו הגג של היציע
   *   והמעקות בהן ישרים לגמרי, וזאת חתימה שאי אפשר לטעות בה.
   *
   * ההבדל אינו קוסמטי. בשדה ראייה של תשעים־ושש מעלות, פיקסל שההטלה הלא נכונה שמה
   * בחמישים מעלות שייך באמת לשלושים ושמונה — עשרה מטר של רחוב, בקצה הפריים.
   */
  proj?: 'cyl' | 'rect'
  /**
   * לאן הרחוב הולך, במעלות מתוך התמונה. אפס = ישר קדימה במרכז הפריים.
   *
   * צלם לא מכוון את המצלמה במדויק לאורך הכביש, ולכן נקודת המגוז של הרחוב יושבת בכל תמונה
   * במקום קצת אחר — בחמש תחנות בלומפילד היא נעה בין ‎−21°‎ ל-‎−8°‎. בלי לתקן את זה, "קדימה"
   * במשחק הוא לא "לאורך הרחוב": השחקן דוחף את המוט קדימה והולך לתוך המעקות.
   *
   * לכן התמונה **מסתובבת** כך שהמגוז שלה יפנה אל `−z`. אחרי זה `yaw = 0` הוא הרחוב עצמו
   * בכל תחנה, וללכת קדימה זה ללכת בכביש. הזווית נמדדת ב-
   * `scripts/life/measure-bloomfield-2026-09-08.py`, לא מוערכת.
   */
  bearingDeg?: number
  /**
   * רדיוס הגליל במטרים. הוא לא משנה את התמונה כשעומדים במרכז — רק את קצב הפרלקסה כשזזים.
   * שלושים מטר זה בערך המרחק לחזית שממול ברחוב תל־אביבי, ולכן הבתים זזים נכון והים כמעט לא.
   */
  radius: number
}

/**
 * הסדר הוא הסדר שהבורר מציג, והוא לא אלפביתי: הוא הדרך. שדרות ירושלים, החזית של בלומפילד,
 * מתחת ליציע — ואז המקומות האחרים בעיר.
 */
export const PLACE_ORDER = [
  'panoBloom24',
  'panoBloom18',
  'panoJaffa',
  'panoBloomWalk1',
  'panoBloomWalk2',
  'panoBloomWalk3',
  'panoBloomWalk4',
  'panoBloomWalk5',
  'panoBloomFacade',
  'panoBloomGate',
  'panoUssOutside',
  'panoTamar',
  'panoCinema',
  'panoPromenade',
  'panoRoomBed',
  'panoRoomKitchen',
  'panoRoomLiving',
  'panoRoomGrocery',
] as const

export const PANOS: Record<string, PanoSpec> = {
  // ארבעה חדרים. אלה לא רחובות — הקירות בארבעה מטר, לא בשלושים, ולכן גם הרדיוס קטן וגם
  // מותר ללכת בהם שני צעדים בלבד. גובה המצלמה (1.10) נמדד מהמרצפות עצמן: רק בו הן יוצאות
  // ריבועיות אחרי היישור, וזה מבחן שאי אפשר להתווכח איתו.
  panoRoomBed: {
    nameHe: 'החדר של פוגי',
    key: 'panoRoomBed', aspect: 2560 / 1086, horizon: 0.56, hFovDeg: 140, eye: 1.1,
    radius: 4.2, walk: 1.4, nearRgb: [108, 99, 91], tile: { key: 'panoRoomBed--tile', wide: 1.4, deep: 1.6 },
  },
  panoRoomKitchen: {
    nameHe: 'המטבח',
    key: 'panoRoomKitchen', aspect: 2560 / 1086, horizon: 0.545, hFovDeg: 140, eye: 1.1,
    radius: 4.2, walk: 1.4, nearRgb: [135, 125, 115], tile: { key: 'panoRoomKitchen--tile', wide: 1.4, deep: 1.6 },
  },
  panoRoomLiving: {
    nameHe: 'הסלון',
    key: 'panoRoomLiving', aspect: 2560 / 1086, horizon: 0.545, hFovDeg: 140, eye: 1.1,
    radius: 4.4, walk: 1.4, nearRgb: [126, 116, 108], tile: { key: 'panoRoomLiving--tile', wide: 1.4, deep: 1.6 },
  },
  panoRoomGrocery: {
    nameHe: 'המכולת',
    key: 'panoRoomGrocery', aspect: 2560 / 1086, horizon: 0.56, hFovDeg: 140, eye: 1.1,
    radius: 3.8, walk: 1.2, nearRgb: [146, 135, 125], tile: { key: 'panoRoomGrocery--tile', wide: 1.29, deep: 1.4 },
  },

  panoPromenade: {
    nameHe: 'הטיילת, הבניין העגול מול הים',
    key: 'panoPromenade', aspect: 2560 / 1029, horizon: 0.72, hFovDeg: 132, eye: 1.7,
    radius: 30, nearRgb: [136, 104, 74], tile: { key: 'panoPromenade--tile', wide: 4.1, deep: 3.0 },
  },
  panoTamar: {
    nameHe: 'פינת קפה תמר',
    key: 'panoTamar', aspect: 2560 / 1029, horizon: 0.735, hFovDeg: 128, eye: 1.7,
    radius: 26, nearRgb: [89, 83, 77], tile: { key: 'panoTamar--tile', wide: 3.96, deep: 1.95 },
  },
  panoCinema: {
    nameHe: 'קולנוע אלנבי, הצומת',
    key: 'panoCinema', aspect: 2560 / 1086, horizon: 0.735, hFovDeg: 130, eye: 1.7,
    radius: 28, nearRgb: [86, 84, 83], tile: { key: 'panoCinema--tile', wide: 5.61, deep: 3.8 },
  },
  // בלומפילד מבחוץ — שתי התחנות של הדרך פנימה. החזית היא רחוב, המרחב מתחת ליציע הוא
  // חלל מקורה ורחב מאוד (מאה וחמישים מעלות), ולכן גם קו האופק בו נמוך: רואים הרבה רצפה.
  panoBloomFacade: {
    nameHe: 'בלומפילד, החזית',
    key: 'panoBloomFacade', aspect: 2560 / 1086, horizon: 0.575, hFovDeg: 150, eye: 1.7,
    radius: 16, nearRgb: [170, 142, 116], tile: { key: 'panoBloomFacade--tile', wide: 1.91, deep: 3.0 },
  },
  panoBloomGate: {
    nameHe: 'בלומפילד, מתחת ליציע',
    key: 'panoBloomGate', aspect: 2560 / 1086, horizon: 0.615, hFovDeg: 120, eye: 1.7,
    radius: 22, nearRgb: [188, 165, 143], tile: { key: 'panoBloomGate--tile', wide: 2.44, deep: 3.2 },
  },
  // אוסישקין מבחוץ — הפינה עם הגג הירוק. שני רחובות ניצבים נפגשים כאן, ונקודות המגוז
  // שלהם על התמונה נותנות את שדה הראייה: המרחק ביניהן הוא בדיוק תשעים מעלות.
  panoUssOutside: {
    nameHe: 'אוסישקין מבחוץ',
    key: 'panoUssOutside', aspect: 2560 / 1029, horizon: 0.745, hFovDeg: 124, eye: 1.7,
    radius: 24, nearRgb: [79, 67, 60], tile: { key: 'panoUssOutside--tile', wide: 3.98, deep: 3.0 },
  },
  // שדרות ירושלים ביפו — הדרך אל בלומפילד. הרחבה ביותר מבין הארבע, ולכן גם הרדיוס גדול
  // יותר: השדרה רחבה, החזיתות רחוקות, והמגדל בקצה כמעט לא זז כשהולכים.
  // חמש תחנות ההליכה לאורך החזית — החבילה שמאור שלח ב-8.9.2026. אלה **תצלומים רגילים**
  // ולא פנורמות: קו הגג של היציע והמעקות בהם ישרים לגמרי. קו האופק נמדד בכל אחת בנפרד
  // מנקודת המגוז של הרחוב, ושדה הראייה — 96° — מזהות שתי נקודות מגוז ניצבות בתחנות 3
  // ו-4. הרדיוס אחיד, כי זאת מצלמה אחת שהלכה קדימה.
  panoBloomWalk1: {
    nameHe: 'בלומפילד, תחנה 1 — מרחוק',
    key: 'panoBloomWalk1', proj: 'rect', aspect: 1923 / 817, horizon: 0.5964, hFovDeg: 96, eye: 1.7, bearingDeg: -20.9,
    radius: 24, nearRgb: [190, 157, 129],
    tile: { key: 'panoBloomWalk1--tile', wide: 2.08, deep: 2.4 },
  },
  panoBloomWalk2: {
    nameHe: 'בלומפילד, תחנה 2',
    key: 'panoBloomWalk2', proj: 'rect', aspect: 1923 / 817, horizon: 0.609, hFovDeg: 96, eye: 1.7, bearingDeg: -19.1,
    radius: 24, nearRgb: [195, 154, 123],
    tile: { key: 'panoBloomWalk2--tile', wide: 2.04, deep: 2.4 },
  },
  panoBloomWalk3: {
    nameHe: 'בלומפילד, תחנה 3 — באמצע',
    key: 'panoBloomWalk3', proj: 'rect', aspect: 1925 / 817, horizon: 0.5918, hFovDeg: 96, eye: 1.7, bearingDeg: -10.3,
    radius: 24, nearRgb: [181, 140, 109],
    tile: { key: 'panoBloomWalk3--tile', wide: 2.08, deep: 2.4 },
  },
  panoBloomWalk4: {
    nameHe: 'בלומפילד, תחנה 4 — מתחת ליציע',
    key: 'panoBloomWalk4', proj: 'rect', aspect: 1925 / 817, horizon: 0.6404, hFovDeg: 96, eye: 1.7, bearingDeg: -12.4,
    radius: 24, nearRgb: [187, 148, 118],
    tile: { key: 'panoBloomWalk4--tile', wide: 2.34, deep: 2.4 },
  },
  panoBloomWalk5: {
    nameHe: 'בלומפילד, תחנה 5 — ליד העמוד',
    key: 'panoBloomWalk5', proj: 'rect', aspect: 1921 / 819, horizon: 0.5914, hFovDeg: 96, eye: 1.7, bearingDeg: -7.9,
    radius: 24, nearRgb: [185, 148, 120],
    tile: { key: 'panoBloomWalk5--tile', wide: 2.08, deep: 2.4 },
  },
  // **התחנה הראשונה שהיא באמת מקום.** ארבע תמונות ריבועיות של אותה נקודה — קדימה, ימינה,
  // אחורה, שמאלה — נתפרו לגליל אחד שלם ב-`scripts/life/stitch-station-2026-09-08.py`.
  // לגליל אין קצה: אפשר להסתובב בו סביב הציר בלי לפגוש גבול, כי הפיקסל שאחרי המעלה
  // ה-359 הוא המעלה הראשונה. זה מה שפותר את הלוח החום שנפתח בצד המסך בתצלום בודד.
  //
  // המרצף כאן הוא **צלחת הרצפה עצמה** — מבט מלמעלה בקנה מידה ידוע של ארבעה על ארבעה
  // מטר. אין כאן יישור ואין מתיחה: מה שמתחת לרגליים צולם, בפעם הראשונה.
  panoBloom24: {
    nameHe: 'בלומפילד, 24 מטר — 360°',
    key: 'panoBloom24', aspect: 4096 / 1099, horizon: 0.6, hFovDeg: 360, eye: 1.7,
    radius: 20, nearRgb: [183, 163, 152],
    tile: { key: 'panoBloom24--tile', wide: 4, deep: 4 },
  },
  // התחנה השנייה של אותו רחוב, שישה מטר קדימה. אותו אופק ואותו רוחב בדיוק כמו הראשונה —
  // לא במקרה: אילו היו שונים, הקרקע הייתה קופצת תחת הרגליים בדיוק ברגע המעבר.
  panoBloom18: {
    nameHe: 'בלומפילד, 18 מטר — 360°',
    key: 'panoBloom18', aspect: 4096 / 1099, horizon: 0.6, hFovDeg: 360, eye: 1.7,
    radius: 20, nearRgb: [184, 163, 152],
    tile: { key: 'panoBloom18--tile', wide: 4, deep: 4 },
  },
  panoJaffa: {
    nameHe: 'שדרות ירושלים, יפו',
    key: 'panoJaffa', aspect: 2560 / 1034, horizon: 0.70, hFovDeg: 128, eye: 1.7,
    radius: 32, nearRgb: [165, 137, 108], tile: { key: 'panoJaffa--tile', wide: 3.0, deep: 4.0 },
  },
}

const ART = '/life/art'

/**
 * כמה רחוק מותר להתרחק מנקודת הצילום לפני שהמרחק עצמו נראה. הפנורמה מדויקת בנקודה אחת,
 * ושני מטר וחצי ממנה עדיין קוראים כהליכה; חמישה מטר כבר מושכים את הכיסאות של בית הקפה
 * לתוך המדרכה, כי לתמונה שטוחה אין דרך לדעת שהם עומדים עליה. זה הגבול של כיס אחד, וממנו
 * מתחיל שרשור הבלוקים.
 */
export const POCKET_METRES = 9

/**
 * כמה הדיסקה נמתחת מעבר לקצה התמונה. הקצה התחתון של הגליל והקצה של הדיסקה מתלכדים בדיוק
 * רק כשהמצלמה בנקודת האפס; ברגע שהיא זזה חצי מטר נפתח ביניהם קו. הטבעת הנוספת עולה כלום,
 * כי מעבר לקצה ההיטל מחזיר בדיוק את אותם פיקסלים שהגליל מראה שם ממילא.
 */
export const DISC_FACTOR = 3.2

/**
 * כמה רחוק מותר ללכת מנקודת הצילום. שני גבולות, והנמוך שבהם קובע: הכיס עצמו
 * (`POCKET_METRES` — מעבר לו הפרלקסה מספרת שזאת תמונה), והרצפה שיש בפועל (מחצית הדיסקה,
 * כדי שגם אחרי הליכה עד הקצה אפשר יהיה להסתובב ולראות רצפה מסביב). מקום שרשם `walk` משלו
 * מקבל אותו כמו שהוא — חדר הוא לא רחוב.
 */
export function walkLimit(spec: PanoSpec): number {
  if (spec.walk !== undefined) return spec.walk
  const floor = Math.min(POCKET_METRES, (nearEdge(spec) * DISC_FACTOR) / 2.5)
  const depth = CITY_DEPTH[spec.key]
  if (!depth) return floor
  // **הקיר הקרוב ביותר הוא הגבול, ובניכוי מטר.** קו המגע נמדד שמרנית — הוא נעצר בכל דבר
  // שעומד על הכביש — ולכן מותר לו להיות קרוב מדי; מה שאסור הוא לאפשר ללכת לתוכו. הגבול
  // נגזר מאותה מדידה בדיוק, ולכן השתיים לא יכולות לסתור זו את זו.
  const nearest = Math.min(...depth.metres)
  return Math.max(1, Math.min(floor, nearest - 1.2))
}

/**
 * שדה הראייה האנכי הגדול ביותר שהתמונה יכולה למלא, במעלות.
 *
 * לפנורמה גלילית יש כיסוי אנכי סופי, והוא נגזר מקו האופק: מהאופק כלפי מעלה היא מגיעה עד
 * `atan(horizon / pxPerRad)`, וכלפי מטה עד `atan((1 − horizon) / pxPerRad)`. מצלמה שפותחת
 * יותר מזה מראה **חור** מעל התמונה או מתחתיה, וזה בדיוק מה שנראה מתחת ליציע בבלומפילד —
 * חלל מקורה שבו קו האופק נמוך, כלומר מעט מאוד תמונה מעל העין.
 *
 * רק הצד העליון נספר. מתחת לקו האופק אין חור לעולם, כי שם הרצפה — ההיטל ההפוך והמרצף
 * המיושר — מכסה עד לרגליים ומעבר לזה. מה שמוגבל הוא כמה שמיים ובניין יש מעל.
 */
/**
 * אורך המוקד, ביחידות של **גובה התמונה**. זה המספר היחיד שמתרגם מטרים לפיקסלים, ושתי
 * ההטלות נבדלות רק בו ובמיפוי האופקי.
 *
 * בגלילית, `y` הוא `R·tan ε` כאשר `R` הוא רדיוס הגליל בפיקסלים — כלומר `רוחב/שדה ראייה`.
 * בתצלום רגיל, `y` הוא `f·tan ε` כאשר `f = (רוחב/2)/tan(שדה/2)`. אותה נוסחה אנכית, שני
 * מספרים שונים: לשדה של ‎96°‎ ויחס ‎2.35‎ יוצא ‎1.40‎ מול ‎0.94‎ — הפרש של חמישים אחוז
 * בגובה של כל דבר בתמונה, ולכן גם במרחק שנגזר ממנו.
 */
export function focal(spec: PanoSpec): number {
  const hFov = (spec.hFovDeg * Math.PI) / 180
  return spec.proj === 'rect' ? spec.aspect / 2 / Math.tan(hFov / 2) : spec.aspect / hFov
}

export function maxFovDeg(spec: PanoSpec): number {
  return (2 * Math.atan(spec.horizon / focal(spec)) * 180) / Math.PI
}

/**
 * כמה מותר להסתובב. לפנורמה גלילית — כל מה שצולם. לתצלום, הפריים נגמר, ומעבר לו אין
 * כלום: המצלמה נעצרת חצי מעלה לפני הקצה, כדי שלא ייפתח פס ריק בצד המסך.
 */
export function maxYawDeg(spec: PanoSpec, cameraFovDeg: number, aspect: number): number {
  // גליל שלם אין לו קצה: הפיקסל שאחרי המעלה ה-359 הוא המעלה הראשונה, ולכן אין מה לחסום.
  if (spec.hFovDeg >= 359) return 180
  const halfCam = (Math.atan(Math.tan((cameraFovDeg * Math.PI) / 360) * aspect) * 180) / Math.PI
  return Math.max(0, spec.hFovDeg / 2 - halfCam - 0.5)
}

/** המרחק שבו הקצה התחתון של הפנורמה פוגש את הכביש — הגבול בין הדיסקה לגליל */
export function nearEdge(spec: PanoSpec): number {
  return (spec.eye * focal(spec)) / (1 - spec.horizon)
}

const GROUND_VERT = `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

/**
 * ההיפוך. לכל נקודה על הרצפה: הזווית סביב הצופה נותנת את `u`, והמרחק ממנו נותן את `v`.
 * `hFov` ו-`aspect` הם המספרים שמתרגמים מטרים לפיקסלים, ו-`horizon` הוא היכן האופס.
 */
const GROUND_FRAG = `
uniform sampler2D map;       // הפנורמה עצמה
uniform sampler2D tile;      // הרצפה המיושרת, מלמעלה, בקנה מידה של מטרים
uniform vec2 tileSize;       // כמה מטרים המרצף מכסה
uniform float hFov;          // רדיאנים
uniform float fN;            // אורך המוקד, ביחידות של גובה התמונה
uniform float rect;          // 1 = תצלום רגיל, 0 = פנורמה גלילית
uniform float bearing;       // לאן הרחוב הולך בתוך התמונה, ברדיאנים
uniform float aspect;        // רוחב/גובה של התמונה
uniform float horizon;       // שבר מהגובה
uniform float eye;           // מטרים
uniform float edge;          // המרחק שבו הקצה התחתון של הפנורמה פוגש את הכביש
uniform float hasTile;       // 1 אם יש מרצף
uniform vec3 origin;         // מרכז הפנורמה בעולם
uniform vec3 nearColour;     // רשת ביטחון: צבע הכביש הנמדד
uniform float alpha;         // שקיפות, בשביל המעבר בין תחנה לתחנה בשרשרת
varying vec3 vWorld;

void main() {
  vec3 d = vWorld - origin;
  float r = length(vec2(d.x, d.z));
  // הזווית **בתוך התמונה**: כיוון העולם ועוד הסטיה של הרחוב מהמרכז. ככה מינוס-z בעולם הוא
  // הרחוב, ולא איפה שהצלם במקרה עמד.
  float theta = atan(d.x, -d.z) + bearing;
  // שתי ההטלות, ושורש ההבדל: בגלילית הזווית עצמה היא הקואורדינטה, ובתצלום זה
  // הטנגנס שלה. וכשהזווית גדולה, גם הסקאלה האנכית נמתחת ב-1/cos θ — שם הקרן ארוכה
  // יותר, ולכן כל דבר בצד הפריים נמצא **נמוך יותר** מאשר אותו דבר בדיוק במרכזו.
  float t = tan(clamp(theta, -1.45, 1.45));
  float u = mix(0.5 + theta / hFov, 0.5 + fN * t / aspect, rect);
  float stretch = mix(1.0, 1.0 / max(cos(theta), 0.06), rect);
  float py = horizon + fN * stretch * (eye / max(r, 0.001));
  // מאחורי הפריים אין תמונה, ולכן גם אין רצפה מוטלת — רק המרצף שמתחת לרגליים.
  if (rect > 0.5 && abs(theta) > hFov * 0.5) u = -1.0;

  // הרחוק: מה שהפנורמה באמת צילמה — סימני כביש, אבני שפה, כתמים. אין תחליף לזה.
  // מעבר לקצה הפריים אין תמונה — אבל **יש מרצף**, והוא רצפה אמיתית באותו קנה מידה.
  // לצבוע שם צבע שטוח פירושו לוח חום ריק על חצי מסך, וזה מה שנראה כשמסתובבים.
  bool outside = u < 0.0 || u > 1.0;
  vec3 shot = outside ? vec3(0.0) : texture2D(map, vec2(u, 1.0 - min(py, 0.998))).rgb;

  // הקרוב: המרצף המיושר, מרוצף במרחב העולם ולכן בפרספקטיבה נכונה בכל מרחק. זה מה שהחליף
  // שלושה ניסיונות שנכשלו — מריחת השורה האחרונה, קיפול הרצועה, וטשטוש לרוחב הזווית —
  // וכולם נכשלו מאותה סיבה: בזווית משיקה פשוט אין מספיק פיקסלים בתמונה.
  vec3 near = hasTile > 0.5 ? texture2D(tile, vWorld.xz / tileSize).rgb : nearColour;
  vec3 far = outside ? near : shot;

  // **ומה שקורה בקצה השני.** ככל שמתרחקים, השורה שההיטל קורא מתקרבת לקו האופק, ובשני
  // אחוזים האחרונים לפניו כבר אין בתמונה מידע: כל הרחוק כולו דחוס שם לכמה שורות. לצייר
  // ממנו רצפה פירושו למרוח את קו הרקיע כלפי מטה על חצי מסך, בפסים אנכיים שטוחים — וזה
  // בדיוק מה שנראה כשהדיסקה הוגדלה. לכן מעבר לגבול הזה חוזרים אל המרצף, שהוא רצפה
  // אמיתית באותו קנה מידה ובפרספקטיבה נכונה.
  float thin = smoothstep(horizon + 0.020, horizon + 0.006, py);
  vec3 reach = mix(far, near, thin);

  // **המעבר, ולמה הוא ארוך.** קצה התמונה הוא מעגל סביב המצלמה, וכשמסתכלים עליו מגובה
  // העין הוא נראה כקו אופקי ישר על פני כל רוחב המסך. מעבר קצר הופך אותו לקו נראה —
  // מדרגה בגוון שחוצה את המדרכה לרוחבה, וזה בדיוק מה שנראה בתחנה השנייה. הרמפה נפתחת
  // לכן שלושה רבעי מטר לפני הקצה ונסגרת מטר וחצי אחריו: אין שום נקודה שבה הגוון קופץ.
  float k = smoothstep(edge * 0.55, edge * 1.60, r);
  gl_FragColor = vec4(mix(near, reach, k), alpha);
}
`

/**
 * הקיר בעל הצורה — מה שהופך "התמונה מתקרבת" ל"אני הולך".
 *
 * גליל ברדיוס אחד אומר שכל מה שנראה נמצא באותו מרחק, ולכן כשהמצלמה זזה הכול זז באותו קצב.
 * כאן כל רצועת אזימוט יושבת ב**מרחק שלה**, כפי שנמדד מקו המגע שלה עם הרצפה
 * (`scripts/life/depth-profile-2026-09-07.py`). חזית בשמונה מטר חולפת מהר, מגדל במאה כמעט
 * לא זז, והשדרה שנמשכת קדימה נשארת פתוחה — וזה בדיוק מה שהעין קוראת כהליכה.
 *
 * הרצועה נבנית מלמעלה (`py = 0`) עד קו המגע שלה, כי מתחתיו הרצפה כבר מטופלת בהיטל ההפוך
 * ולא צריך קיר. הגובה נגזר מאותה גיאומטריה: `y = r · tan ε`, ו-`tan ε` הוא בדיוק מה
 * שהשורה בתמונה מודדת.
 */
/**
 * עד כמה רחוק מודדים קיר.
 *
 * "פתוח" נמדד כמאה וארבעים מטר, וזה נכון — אבל רצועה בשמונה מטר שכנה לרצועה במאה וארבעים
 * יוצרת מצוק, והמשולש שנמתח ביניהן הוא **מריחה**: ברגע שהמצלמה זזה שני מטר, גג היציע
 * נמשך לקשת חלקה על חצי מסך. מעבר לארבעים וחמישה מטר הפרלקסה ממילא כמעט אפסית — הליכה
 * של חמישה מטר מזיזה שם פחות מחצי מעלה — ולכן אין מה להפסיד מלקצר את המצוק פי שלושה.
 */
const WALL_MAX = 45

function shapedWall(depth: CityDepth, spec: PanoSpec, hFov: number): THREE.BufferGeometry {
  const n = depth.metres.length
  const rows = 24
  const fN = focal(spec)
  const rect = spec.proj === 'rect'
  const from = (depth.fromDeg * Math.PI) / 180
  const to = (depth.toDeg * Math.PI) / 180

  const position: number[] = []
  const uv: number[] = []
  const index: number[] = []

  for (let i = 0; i < n; i += 1) {
    const theta = from + ((to - from) * i) / (n - 1)
    const r = Math.min(depth.metres[i] ?? depth.far, WALL_MAX)
    // אורך הקרן אל העמודה הזאת, ביחידות של גובה התמונה. בגלילית היא תמיד `fN`; בתצלום
    // היא נמתחת ככל שמתרחקים מהמרכז, וזה בדיוק מה שמחזיר את קווי הגג לישרים.
    const k = rect ? fN / Math.cos(theta) : fN
    const u = rect ? 0.5 + (fN * Math.tan(theta)) / spec.aspect : 0.5 + theta / hFov
    // קו המגע של הרצועה הזאת: מתחתיו זו כבר רצפה, ולשם הקיר לא יורד
    const contact = Math.min(0.999, spec.horizon + (k * spec.eye) / Math.max(r, 0.5))
    for (let j = 0; j < rows; j += 1) {
      const py = (contact * j) / (rows - 1)
      const y = (r * (spec.horizon - py)) / k
      position.push(r * Math.sin(theta), y, -r * Math.cos(theta))
      uv.push(u, 1 - py)
    }
  }
  for (let i = 0; i < n - 1; i += 1) {
    for (let j = 0; j < rows - 1; j += 1) {
      const a = i * rows + j
      const b = a + rows
      index.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geometry.setIndex(index)
  return geometry
}

export type Pano = {
  group: THREE.Group
  /** גובה העין — המצלמה יושבת ב-y=0 של הקבוצה, הכביש ב-`-eye` */
  eye: number
  /** מרחק המפגש בין הדיסקה לגליל */
  nearEdge: number
  /**
   * דעיכה. תחנה בשרשרת נכנסת ויוצאת ברציפות, ולכן גם הגליל וגם הרצפה חייבים שקיפות אחת
   * משותפת. מתחת ל-0.01 הקבוצה כולה נכבית, כדי שתחנות רחוקות לא יעלו כלום.
   */
  setAlpha: (value: number) => void
  /** מי נצבע מעל מי */
  setOrder: (index: number) => void
  dispose: () => void
}

/**
 * בונה את החלל. המצלמה אמורה לשבת בנקודה `origin` שנמסרה — שם, ורק שם, התמונה נראית
 * בדיוק כפי שצולמה.
 */
export function buildPano(spec: PanoSpec, loader: THREE.TextureLoader, origin = new THREE.Vector3()): Pano {
  const group = new THREE.Group()
  const hFov = (spec.hFovDeg * Math.PI) / 180
  const map = loader.load(`${ART}/${spec.key}.png`)
  map.colorSpace = THREE.SRGBColorSpace
  map.minFilter = THREE.LinearMipmapLinearFilter
  map.magFilter = THREE.LinearFilter
  map.generateMipmaps = true
  map.anisotropy = 16

  const rect = spec.proj === 'rect'
  const bearing = ((spec.bearingDeg ?? 0) * Math.PI) / 180
  const fN = focal(spec)
  const worldHeight = spec.radius / fN         // גובה התמונה בעולם, במרחק הרדיוס
  const centreY = worldHeight * (spec.horizon - 0.5)

  const depth = CITY_DEPTH[spec.key]

  // המעטפת. לפנורמה גלילית זה גליל; לתצלום זה **מסך שטוח** — כי בדיוק כך התמונה נוצרה,
  // וכל דבר אחר יעקם קווים שהיו ישרים. `CylinderGeometry` מודד את הזווית מ-`+z`, כלומר
  // מאחורי המצלמה; `π` מסובב אותו לקדימה.
  // **המסך גדול מהתמונה.** תצלום נגמר בקצה הפריים, ומצלמה שזזה חמישה מטר קדימה רואה
  // פחות ממנו בזווית — ואז נפתח בצד המסך שטח ריק. המישור נבנה רחב וגבוה פי אחד וחצי,
  // וה-UV שלו חורג מהטווח: three עוצר בקצה הטקסטורה (`ClampToEdge`), ולכן מעבר לפריים
  // נמשך הפיקסל האחרון. זאת בדיוק ההחלטה שכבר התקבלה לרצועה התחתונה של כל רקע במשחק:
  // מריחה של הקצה היא לא המצאה, וחור שחור כן נראה כתקלה.
  const OVER = 1.5
  const shell = rect
    ? new THREE.PlaneGeometry(worldHeight * spec.aspect * OVER, worldHeight * OVER, 1, 1)
    : new THREE.CylinderGeometry(
      spec.radius, spec.radius, worldHeight, 160, 1, true, Math.PI - hFov / 2, hFov,
    )
  if (!rect) {
    // הגליל נצפה מבפנים, ולכן `u` רץ מימין לשמאל. ההיפוך על הגיאומטריה ולא על הטקסטורה,
    // כי אותה טקסטורה משמשת גם את ה-shader של הרצפה — ושם `repeat`/`offset` לא חלים בכלל.
    const uv = shell.getAttribute('uv') as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i += 1) uv.setX(i, 1 - uv.getX(i))
    uv.needsUpdate = true
  } else {
    // המישור נבנה סביב הראשית ופונה אל `+z`; המצלמה מסתכלת אל `-z`, ולכן הוא נדחף
    // לשם ונשאר פונה אליה. `u` כאן כבר רץ שמאלה-לימינה כמו בתמונה, בלי היפוך.
    shell.translate(0, 0, -spec.radius)
    const uv = shell.getAttribute('uv') as THREE.BufferAttribute
    const spill = (OVER - 1) / 2
    for (let i = 0; i < uv.count; i += 1) {
      uv.setXY(i, uv.getX(i) * OVER - spill, uv.getY(i) * OVER - spill)
    }
    uv.needsUpdate = true
  }

  // **תצלום קרוב לא צריך קיר בעל צורה.** הקיר נבנה בשביל פנורמה בודדת שממנה מתרחקים
  // עשרה מטר: שם הוא ההבדל בין "התמונה מתקרבת" ל"אני הולך". ברחוב שיש בו תחנה כל אחת
  // עשרה מטר, הפרלקסה מגיעה מהתחנות עצמן — והקיר רק מזיק: כל מצוק בין רצועה בשמונה מטר
  // לרצועה פתוחה נמתח למריחה חלקה ברגע שזזים שני מטר, והוא חוסם דמויות שעומדות מאחוריו
  // כאילו הוא בטון. מסך שטוח לא עושה אף אחד מהשניים.
  const shaped = depth && spec.proj !== 'rect' ? shapedWall(depth, spec, hFov) : null
  const wall = new THREE.Mesh(
    shaped ?? shell,
    new THREE.MeshBasicMaterial({
      map,
      // הגליל נצפה מבפנים; הקיר בנוי כבר עם הפאה הנכונה, אבל שתי הפאות עולות כלום ומצילות
      // מבאג ניווט שקשה לראות אותו בצילום סטטי.
      side: shaped || rect ? THREE.DoubleSide : THREE.BackSide,
      toneMapped: false,
      depthWrite: true,
    }),
  )
  wall.renderOrder = -3
  // הגליל נבנה סביב מרכזו ולכן צריך הסטה; הקיר בעל הצורה נבנה כבר בגבהים המוחלטים שלו,
  // ולהוסיף לו את אותה הסטה זה להרים את כל הרחוב חמישה מטר באוויר. זה בדיוק מה שקרה.
  wall.position.copy(origin)
  // הסיבוב הוא סביב נקודת הצילום עצמה, ולכן הוא מיישר את הרחוב בלי להזיז את התחנה
  wall.rotation.y = -bearing
  if (!shaped) wall.position.add(new THREE.Vector3(0, centreY, 0))
  group.add(wall)

  let backdrop: THREE.Mesh | null = null
  // **רשת ביטחון מאחורי הקיר.** לקיר בעל צורה יש מצוקים — עמוד קרוב ומאחוריו רחוב פתוח —
  // וברגע שהמצלמה זזה נפתחים ביניהם חריצים. בלי משהו מאחור החריץ שחור, וזה נראה כתקלה.
  // הגליל המקורי נשאר, ברדיוס הרחוק, ומצויר ראשון: אותה תמונה בדיוק, רק במרחק. חריץ מראה
  // את הרחוב מרחוק במקום חור.
  if (shaped) {
    backdrop = new THREE.Mesh(
      shell.clone(),
      new THREE.MeshBasicMaterial({
        map, side: rect ? THREE.DoubleSide : THREE.BackSide, toneMapped: false, depthWrite: true,
      }),
    )
    const far = depth?.far ?? spec.radius
    backdrop.scale.setScalar(far / spec.radius)
    backdrop.position.copy(origin).add(new THREE.Vector3(0, (centreY * far) / spec.radius, 0))
    backdrop.rotation.y = -bearing
    backdrop.renderOrder = -4
    group.add(backdrop)
  }

  // הרצפה מקבלת עותק **בלי מיפמאפים**, וזה לא פרט טכני: במבט משופע ה-GPU רואה שהטקסטורה
  // נדחסת מאוד לאורך הקרן, בוחר את רמת המיפמאפ הקטנה ביותר — ממוצע כל הפנורמה — וצובע את
  // הכביש בחום־שחור אחיד עם פסים. זה בדיוק מה שנראה בצילום השני. הדיסקה מכסה רק שבעה מטר,
  // כלומר תמיד קרובה, ולכן אין לה שום צורך במיפמאפים מלכתחילה.
  const groundMap = loader.load(`${ART}/${spec.key}.png`)
  // `NoColorSpace`, ולא sRGB, וזה השורש של הכביש השחור בשלושת הצילומים הראשונים: כשטקסטורה
  // מסומנת sRGB היא נטענת לחומרה בפורמט SRGB8, והדגימה **מפענחת** אותה ל-linear. חומר רגיל
  // של three מקודד חזרה בסוף ה-shader; ShaderMaterial גולמי לא מקודד כלום, ולכן 86 יצא 24.
  // כאן הכל נשאר במרחב אחד — בייטים כמו בקובץ, נכתבים כמו שהם.
  groundMap.colorSpace = THREE.NoColorSpace
  groundMap.generateMipmaps = false
  groundMap.minFilter = THREE.LinearFilter
  groundMap.magFilter = THREE.LinearFilter

  const edge = nearEdge(spec)
  const tileMap = spec.tile ? loader.load(`${ART}/${spec.tile.key}.png`) : null
  if (tileMap) {
    tileMap.colorSpace = THREE.NoColorSpace
    // מראה־ריצוף ולא ריצוף רגיל: קצוות המרצף לא תואמים זה לזה, והמראה מבטלת את התפר בלי
    // לדרוש מרצף שנתפר ידנית.
    tileMap.wrapS = tileMap.wrapT = THREE.MirroredRepeatWrapping
    // **בלי מיפמאפים, ומאותה סיבה בדיוק כמו הרצפה.** במבט מפולס הקרן משיקה לרצפה, ה-GPU
    // רואה שהמרצף נדחס מאוד לאורכה ובוחר את רמת המיפמאפ הקטנה ביותר — ממוצע של המרצף
    // כולו. עם מראה־ריצוף כל חזרה מקבלת אז צבע שטוח אחד, והרצפה יוצאת פסים אנכיים
    // בגוונים של חול. זה בדיוק מה שנראה בחזית בלומפילד, ובשדרות ירושלים לא — כי שם קו
    // האופק נמוך והמרצף בכלל לא מגיע לזווית הזאת.
    //
    // המרצף מכסה שישה מטר וחצי ותו לא — הוא תמיד קרוב, ולכן מיפמאפים לא קונים לו כלום.
    tileMap.minFilter = THREE.LinearFilter
    tileMap.magFilter = THREE.LinearFilter
    tileMap.generateMipmaps = false
    tileMap.anisotropy = 16
  }
  // **הדיסקה חייבת להגיע עד הקיר.** הקיר בעל הצורה נעצר בקו המגע שלו, ומתחתיו הרצפה
  // אמורה לכסות — אבל דיסקה של ארבעה־עשר מטר מול חזית ב-140 משאירה ביניהם **חלון**,
  // ובחלון הזה נראה הרקע הרחוק מלמטה: השורה התחתונה של התמונה, מתוחה על חצי מסך, בפסים
  // אנכיים בגוון חול. זה מה שראינו בחזית בלומפילד ולא בשדרות ירושלים, שם הדיסקה גדולה
  // יותר וקו האופק נמוך. ההיטל ההפוך תקף בכל מרחק — הוא רק נעשה משיק יותר — ולכן דיסקה
  // גדולה היא תמיד הבחירה הנכונה, והמחיר שלה הוא אפס.
  const reach = Math.min(140, Math.max(edge * DISC_FACTOR, depth ? depth.far : 0))
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(reach, 192),
    new THREE.ShaderMaterial({
      uniforms: {
        map: { value: groundMap },
        tile: { value: tileMap ?? groundMap },
        tileSize: { value: new THREE.Vector2(spec.tile?.wide ?? 1, spec.tile?.deep ?? 1) },
        hasTile: { value: tileMap ? 1 : 0 },
        edge: { value: edge },
        hFov: { value: hFov },
        fN: { value: fN },
        rect: { value: rect ? 1 : 0 },
        bearing: { value: ((spec.bearingDeg ?? 0) * Math.PI) / 180 },
        aspect: { value: spec.aspect },
        horizon: { value: spec.horizon },
        eye: { value: spec.eye },
        origin: { value: origin.clone() },
        // `Vector3` ולא `Color`, וזאת לא קפדנות: מאז r152 `THREE.Color` ממיר כל הקס
        // ל-linear ברגע הבנייה, ואילו `texture2D` ב-ShaderMaterial גולמי מחזיר sRGB כמו
        // שהוא — הפלט לא עובר המרה בכלל. לערבב את השניים פירושו כביש שחור, וזה בדיוק מה
        // שנראה בשני הצילומים הראשונים. שלושת המספרים כאן הם הבייטים של התמונה עצמה.
        alpha: { value: 1 },
        nearColour: {
          value: new THREE.Vector3(
            spec.nearRgb[0] / 255,
            spec.nearRgb[1] / 255,
            spec.nearRgb[2] / 255,
          ),
        },
      },
      vertexShader: GROUND_VERT,
      fragmentShader: GROUND_FRAG,
      transparent: true,
      // **הרצפה לא כותבת עומק, לעולם.** שתי תחנות שכנות מציבות שתי דיסקות באותו גובה
      // בדיוק; אם שתיהן כותבות, הן נלחמות על כל פיקסל של כביש והמסך מרצד. בלי כתיבה הן
      // פשוט נצבעות זו אחרי זו לפי `renderOrder`, וזה גם הסדר הנכון ממילא.
      depthWrite: false,
    }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.copy(origin).add(new THREE.Vector3(0, -spec.eye, 0))
  group.add(ground)

  const wallMaterial = wall.material as THREE.MeshBasicMaterial
  const groundMaterial = ground.material as THREE.ShaderMaterial

  return {
    group,
    eye: spec.eye,
    nearEdge: edge,
    /** סדר ציור. תחנה שנכנסת חייבת להיצבע מעל זו שיוצאת, אחרת הדעיכה מהבהבת. */
    setOrder(index: number) {
      wall.renderOrder = -3 + index * 0.02
      ground.renderOrder = -2 + index * 0.02
    },
    setAlpha(value: number) {
      const a = Math.max(0, Math.min(1, value))
      group.visible = a > 0.01
      wallMaterial.transparent = a < 0.999
      wallMaterial.opacity = a
      wallMaterial.depthWrite = a > 0.5
      groundMaterial.uniforms.alpha!.value = a
    },
    dispose() {
      wall.geometry.dispose()
      ;(wall.material as THREE.Material).dispose()
      ground.geometry.dispose()
      ;(ground.material as THREE.Material).dispose()
      backdrop?.geometry.dispose()
      if (backdrop) (backdrop.material as THREE.Material).dispose()
      map.dispose()
      groundMap.dispose()
      tileMap?.dispose()
    },
  }
}
