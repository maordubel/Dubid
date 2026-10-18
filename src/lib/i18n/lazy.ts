/**
 * i18n/lazy.ts — מחרוזות שנקבעות בזמן הקריאה (לא בטעינת המודול).
 * מבנה שנבנה בטעינה (Record/מערך קבוע) חייב להישאר API זהה, אבל להחזיר את
 * השפה הפעילה בכל קריאה — getter מבצע בדיוק את זה.
 */
import { tr, type DictKey } from './dict.ts';

export function lazyRec<K extends string>(
  ids: readonly K[], keyOf: (id: K) => DictKey,
): Record<K, string> {
  const o = {} as Record<K, string>;
  for (const id of ids) {
    Object.defineProperty(o, id, { enumerable: true, get: () => tr(keyOf(id)) });
  }
  return o;
}

/** מוסיף getters למחרוזות של אובייקט קיים: lazyFields({ id }, { headline: key }). */
export function lazyFields<T extends object, F extends Record<string, DictKey>>(
  base: T, fields: F,
): T & { readonly [P in keyof F]: string } {
  const o = { ...base } as T & { readonly [P in keyof F]: string };
  for (const [name, key] of Object.entries(fields)) {
    Object.defineProperty(o, name, { enumerable: true, get: () => tr(key as DictKey) });
  }
  return o;
}

/** מפצל מחרוזת עם {name} למקטעים סביב מקום לצמת React (למשל span.num). */
export function splitAt(template: string, name: string): [string, string] {
  const i = template.indexOf(`{${name}}`);
  return i < 0 ? [template, ''] : [template.slice(0, i), template.slice(i + name.length + 2)];
}

/** תבנית בשפה הפעילה → מזהה Intl. */
export const INTL_TAG = { he: 'he-IL', en: 'en-GB', el: 'el-GR' } as const;
