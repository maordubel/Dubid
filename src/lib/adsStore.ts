/**
 * lib/adsStore.ts — מאגר המודעות החי, והמדידה.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ אותו דפוס בדיוק כמו `content.ts`
 * ═══════════════════════════════════════════════════════════════
 *
 * ברירות המחדל חיות בקוד (`DEFAULT_ADS`), והמסד **דורס** אותן.
 * טבלה ריקה = בדיוק המוצר של היום. אין מצב שבו רצועת הפרסום
 * ריקה כי הדאטה לא הגיעה או כי המיגרציה לא רצה.
 *
 * ★ למה `adsAll()` סינכרוני
 *
 * הוא נקרא בתוך רינדור. `useEffect` + `useState` בכל יחידת
 * פרסום היה אומר שכל מסך מבקש את אותה רשימה בנפרד, ושכל
 * החלפת מסך מהבהבת. מודול אחד שמחזיק את הרשימה ומודיע
 * בשינוי הוא הדפוס שכבר קיים כאן לתוכן, לחוקים ולהגשות.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★★ המדידה — ולמה היא לא חוסמת כלום ★★
 * ═══════════════════════════════════════════════════════════════
 *
 * `trackAd` היא **fire-and-forget**. היא לא מחזירה הבטחה, לא
 * זורקת, ולא מעכבת ניווט.
 *
 * הקליק הוא המקרה החשוב: המשתמש לוחץ על קישור שפותח לשונית
 * חדשה, ואם היינו מחכים לתשובת השרת לפני הניווט היינו מוסיפים
 * השהיה מורגשת לפעולה היחידה שאנחנו רוצים שתקרה. עדיף לאבד
 * קליק מדוד מדי פעם מאשר להאט כל קליק.
 */
import { supabase } from './supabase.ts';
import { DEFAULT_ADS, type HouseAd, type Brand } from './houseAds.ts';
import type { Placement } from './growth.ts';

let ads: HouseAd[] = DEFAULT_ADS;
let loaded = false;

const EVENT = 'dubid:ads';

function notify() {
  try { window.dispatchEvent(new Event(EVENT)); } catch { /* SSR */ }
}

export function subscribeToAds(cb: () => void): () => void {
  try {
    window.addEventListener(EVENT, cb);
    return () => window.removeEventListener(EVENT, cb);
  } catch {
    return () => {};
  }
}

/** כל המודעות שידועות כרגע — ברירות מחדל או מה שהאדמין הגדיר. */
export function adsAll(): HouseAd[] {
  return ads;
}

export function adsLoaded(): boolean {
  return loaded;
}

/**
 * ממיר שורה מהמסד לטיפוס של האפליקציה.
 *
 * ★ שורה פגומה מוחזרת כ-`null` ומסוננת, ולא מפילה את הרשימה.
 *   מודעה אחת עם JSON שבור לא יכולה להשבית את כל הפרסום.
 */
function fromRow(row: unknown): HouseAd | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.headline !== 'string') return null;

  const brand = (r.brand === 'takemeout' || r.brand === 'offsides')
    ? (r.brand as Brand)
    : null;
  if (!brand) return null;

  return {
    id: r.id,
    brand,
    enabled: r.enabled !== false,
    weight: typeof r.weight === 'number' ? r.weight : 5,
    headline: r.headline,
    body: typeof r.body === 'string' ? r.body : '',
    cta: typeof r.cta === 'string' ? r.cta : 'להעיף מבט',
    url: typeof r.url === 'string' ? r.url : '',
    placements: Array.isArray(r.placements) ? (r.placements as Placement[]) : [],
    startsAt: typeof r.startsAt === 'string' ? r.startsAt : null,
    endsAt: typeof r.endsAt === 'string' ? r.endsAt : null,
  };
}

/**
 * מושך את המודעות הפעילות.
 *
 * ★ כישלון שקט לחלוטין, בדיוק כמו `hydrateContent`. פרסום פנימי
 *   לא צריך להפיל שום דבר, ולא צריך להציג הודעת שגיאה למשתמש
 *   שלא ביקש אותו מלכתחילה.
 *
 * ★★ טבלה ריקה **אינה** דריסה.
 *   `house_ads()` שמחזירה מערך ריק היא בדיוק המצב של מסד שבו
 *   המיגרציה רצה ואף אחד עוד לא הגדיר מודעה. אילו היינו דורסים
 *   בריק, כל פרויקט חדש היה מאבד את שתי המודעות שהמוצר נשלח
 *   איתן — בשקט, ובלי שאיש ישים לב.
 */
export async function hydrateAds(): Promise<void> {
  try {
    const { data, error } = await supabase.rpc('house_ads');
    if (error || !Array.isArray(data)) return;

    const rows = (data as unknown[]).map(fromRow).filter((x): x is HouseAd => x !== null);
    if (rows.length === 0) return;

    ads = rows;
    loaded = true;
    notify();
  } catch {
    /* ברירות המחדל תקפות */
  }
}

/** דריסה מקומית — ללוח הניהול, כדי שהתצוגה תתעדכן מיד אחרי שמירה. */
export function setAds(next: HouseAd[]): void {
  ads = next.length > 0 ? next : DEFAULT_ADS;
  loaded = true;
  notify();
}

/* ================================================================== */
/* מדידה                                                              */
/* ================================================================== */

export type AdEvent = 'impression' | 'click';

/**
 * ★ נגד ספירה כפולה בצד הלקוח.
 *
 * חשיפה נספרת פעם אחת לכל שילוב (מודעה · מסך · סבב). בלי זה
 * כל רינדור מחדש של React — ויש הרבה — היה מוסיף חשיפה, וה-CTR
 * היה נראה אפסי בלי שום קשר למציאות.
 */
const sent = new Set<string>();

export function trackAd(adId: string, placement: Placement, event: AdEvent): void {
  /* קליק תמיד נשלח: הוא נדיר, הוא הכוונה עצמה, ואסור לאבד אותו. */
  if (event === 'impression') {
    const key = `${adId}:${placement}`;
    if (sent.has(key)) return;
    sent.add(key);
  }

  try {
    void supabase.rpc('ad_event', {
      p_ad_id: adId, p_placement: placement, p_event: event,
    }).then(() => undefined, () => undefined);
  } catch {
    /* מדידה שנכשלת לא מפריעה לכלום */
  }
}

/** לבדיקות: מאפס את מסנן החשיפות. */
export function resetAdTracking(): void {
  sent.clear();
}
