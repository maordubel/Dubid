/**
 * lib/content.ts — כל מחרוזת שיווקית, בלי פריסה.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ מה נכנס לכאן ומה לא
 * ═══════════════════════════════════════════════════════════════
 *
 * **נכנס:** כותרות, משפטי שיווק, הודעת מערכת, וקישורי קמפיין.
 * כלומר כל דבר שהוא **החלטה שיווקית**.
 *
 * **לא נכנס:** תוויות של כפתורים, הודעות שגיאה, ושמות מסכים.
 * ממשק שנשבר כי מישהו ניקה שורה בטבלה הוא מוצר שבור, לא קמפיין
 * שהשתנה.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ החוק היחיד: ברירת מחדל בקוד, תמיד
 * ═══════════════════════════════════════════════════════════════
 *
 * המסד הוא **override**, לא מקור. טבלה ריקה = בדיוק המוצר של
 * היום. מפתח שנמחק = חזרה לברירת המחדל. אין מצב שבו המסך ריק
 * כי הדאטה לא הגיעה.
 *
 * זו אותה החלטה בדיוק כמו ב-`ruleOverrides.ts`, ומאותה סיבה.
 */
import { supabase } from './supabase.ts';

/**
 * ★ הרשימה הזו היא גם התיעוד וגם הממשק.
 *
 * לוח הניהול בונה את הטופס שלו מכאן — ולכן מפתח חדש נוסף
 * במקום אחד, ומופיע בלוח מיד. אין רשימה שנייה שתישאר מאחור.
 */
export interface ContentKey {
  key: string;
  label: string;
  /** מה שיוצג אם אף אחד לא שינה. */
  fallback: string;
  group: 'לובי' | 'הרכב' | 'תוצאות' | 'שיווק' | 'הודעות';
  hint?: string;
  /** `true` = טקסט ארוך, תיבה רב-שורתית. */
  long?: boolean;
}

export const CONTENT_KEYS: ContentKey[] = [
  { key: 'lobby.hero.kicker', label: 'שורת העל בלובי', group: 'לובי',
    fallback: '', hint: 'ריק = לא מוצג. מקום להכרזה קצרה.' },

  { key: 'mode.five.tagline', label: 'משפט · דוביד 5', group: 'לובי',
    fallback: 'בחרו 5. נצחו את כולם.' },
  { key: 'mode.full.tagline', label: 'משפט · דוביד 11', group: 'לובי',
    fallback: 'בנו הרכב. שלטו בליגה.' },

  { key: 'submit.success', label: 'אחרי הגשה', group: 'הרכב',
    fallback: 'תראו להם את הבחירות — לפני שיודעים מי צדק.' },
  { key: 'share.cta', label: 'קריאה לפעולה בכרטיס', group: 'שיווק',
    fallback: 'חושב שאתה מבין יותר?' },
  { key: 'share.text', label: 'טקסט השיתוף', group: 'שיווק', long: true,
    fallback: '', hint: 'ריק = הטקסט האוטומטי (כולל שם הקפטן).' },

  { key: 'results.empty', label: 'לפני שהתוצאות פורסמו', group: 'תוצאות',
    fallback: 'התוצאות יתפרסמו בסיום המחזור.' },

  { key: 'announce.text', label: 'הודעת מערכת', group: 'הודעות', long: true,
    fallback: '', hint: 'ריק = לא מוצגת. מופיעה בראש הלובי לכולם.' },
  { key: 'announce.tone', label: 'טון ההודעה', group: 'הודעות',
    fallback: 'info', hint: 'info · warn · alert' },
];

const FALLBACKS: Record<string, string> = Object.fromEntries(
  CONTENT_KEYS.map((c) => [c.key, c.fallback]),
);

/* ================================================================== */

let overrides: Record<string, string> = {};
let loaded = false;

const EVENT = 'dubid:content';

function notify() {
  try { window.dispatchEvent(new Event(EVENT)); } catch { /* SSR */ }
}

export function subscribeToContent(cb: () => void): () => void {
  try {
    window.addEventListener(EVENT, cb);
    return () => window.removeEventListener(EVENT, cb);
  } catch {
    return () => {};
  }
}

/**
 * הטקסט שצריך להציג.
 *
 * ★ סינכרוני, כי הוא נקרא בתוך רינדור — אותו דפוס כמו
 *   `listEntries` ו-`playerStatus`.
 */
export function text(key: string): string {
  const v = overrides[key];
  return typeof v === 'string' && v.length > 0 ? v : (FALLBACKS[key] ?? '');
}

/** `true` = יש מה להציג. לשדות שריקים כברירת מחדל. */
export function hasText(key: string): boolean {
  return text(key).trim().length > 0;
}

export function contentLoaded(): boolean {
  return loaded;
}

/**
 * מושך את כל התוכן הפעיל.
 *
 * ★ כישלון שקט לחלוטין: המוצר ממשיך עם ברירות המחדל, וזה
 *   בדיוק מה שהיה לפני שהמערכת הזו נבנתה. תוכן שיווקי לא
 *   צריך להפיל שום דבר.
 */
export async function hydrateContent(): Promise<void> {
  try {
    const { data, error } = await supabase.rpc('content_all');
    if (error || !data) return;

    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      /* המסד מחזיק JSONB. מחרוזת היא המקרה הרגיל; כל דבר אחר
         מומר, כדי שערך שנשמר בטעות כמספר לא ירנדר כ-[object]. */
      if (typeof v === 'string') next[k] = v;
      else if (typeof v === 'number' || typeof v === 'boolean') next[k] = String(v);
    }
    overrides = next;
    loaded = true;
    notify();
  } catch {
    /* ברירות המחדל תקפות */
  }
}
