/**
 * lib/playerNames.ts — שמות קצרים מובחנים + חיפוש רב-לשוני (H02).
 *
 * ★ חיפוש: לפי כל השמות האמיתיים של השחקן (he/en/el), לא רק המחרוזת שמוצגת.
 *   משתמש באנגלית שמקליד "כהן" או "Cohen" מוצא את אותו שחקן. אין fuzzy —
 *   רק נרמול אותיות/רווחים/סימנים.
 * ★ שם קצר: שם משפחה. כששניים או יותר במאגר חולקים אותו — אות ראשונה + משפחה
 *   ("N. Cohen"); אם עדיין יש התנגשות — השם המלא. השם המלא תמיד זמין בגיליון.
 */

const usable = (s: string | null | undefined): s is string =>
  !!s && s.trim() !== '' && s.trim().toUpperCase() !== 'TBD';

/** אותיות קטנות, בלי ניקוד/סימנים/רווחים כפולים — "Abu-Neil" ≡ "abu neil". */
export function normSearch(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-֑ͯ-ׇ]/g, '')   // סימנים דיאקריטיים + ניקוד
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** מזהה → טקסט חיפוש מנורמל (כל השמות). liveData ממלא; מאגר סטטי — נפילה לשם המוצג. */
export const PLAYER_SEARCH = new Map<string, string>();

export function setPlayerSearch(id: string, names: Array<string | null | undefined>): void {
  PLAYER_SEARCH.set(id, [...new Set(names.filter(usable).map(normSearch))].join(' | '));
}

export function matchesPlayer(id: string, displayName: string, query: string): boolean {
  const q = normSearch(query);
  if (!q) return true;
  const hay = PLAYER_SEARCH.get(id) ?? normSearch(displayName);
  return hay.includes(q) || (PLAYER_SEARCH.has(id) && normSearch(displayName).includes(q));
}

/** שמות קצרים ייחודיים למאגר נתון. */
export function distinctShortNames(rows: ReadonlyArray<{ id: string; name: string }>): Map<string, string> {
  const parts = (n: string) => n.trim().split(/\s+/).filter(Boolean);
  const last = (n: string) => { const p = parts(n); return p.length > 1 ? p[p.length - 1] : n.trim(); };
  const initial = (n: string) => {
    const p = parts(n);
    return p.length > 1 ? `${p[0].charAt(0)}. ${p[p.length - 1]}` : n.trim();
  };
  const count = (keys: string[]) => keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>());

  const lastN = count(rows.map((r) => last(r.name)));
  const initN = count(rows.filter((r) => (lastN.get(last(r.name)) ?? 0) > 1).map((r) => initial(r.name)));
  const out = new Map<string, string>();
  for (const r of rows) {
    const l = last(r.name);
    if ((lastN.get(l) ?? 0) <= 1) { out.set(r.id, l); continue; }
    const i = initial(r.name);
    out.set(r.id, (initN.get(i) ?? 0) <= 1 ? i : r.name.trim());
  }
  return out;
}
