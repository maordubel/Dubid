/**
 * lib/teamCodes.ts — קודי מועדון בני 3 אותיות לאנגלית/יוונית (U02). מודול טהור.
 * Hapoel Tel Aviv → HTA · Maccabi Haifa → MHA · Hapoel Beer Sheva → HBS.
 */
import type { Locale } from './i18n/locales.ts';

export function codeCandidates(name: string): string[] {
  const words = name.replace(/[^\p{L}\s-]/gu, ' ').split(/[\s-]+/)
    .filter((w) => w && !/^(fc|cf|sc|ac|f\.c\.|bc)$/i.test(w));
  const up = (x: string) => x.toUpperCase();
  const out: string[] = [];
  if (words.length >= 3) out.push(up(words[0][0] + words[1][0] + words[2][0]));
  if (words.length >= 2) {
    out.push(up(words[0][0] + words[1].slice(0, 2)));
    out.push(up(words[0][0] + words[1][0] + (words[1][1] ?? '')));
    out.push(up(words[0][0] + words[words.length - 1].slice(0, 2)));
    out.push(up(words[0].slice(0, 2) + words[1][0]));
  }
  const flat = words.join('');
  if (flat.length >= 3) out.push(up(flat.slice(0, 3)), up(flat[0] + flat[1] + flat[flat.length - 1]));
  return out.filter((c) => c.length === 3);
}

/** אחרי `localizedShort` לכל הליגה: קוד כפול מקבל את המועמד הבא שעוד פנוי. */
export function uniqueShorts(
  rows: Array<{ short: string; nameHe: string; nameEn?: string | null; nameEl?: string | null }>, l: Locale,
): void {
  if (l === 'he') return;
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(r.short, (seen.get(r.short) ?? 0) + 1);
  const taken = new Set(rows.map((r) => r.short));
  for (const r of rows) {
    if ((seen.get(r.short) ?? 0) < 2) continue;
    const nm = (l === 'el' ? r.nameEl : null) || r.nameEn || '';
    const next = codeCandidates(nm).find((c) => !taken.has(c));
    if (next) { seen.set(r.short, (seen.get(r.short) ?? 1) - 1); r.short = next; taken.add(next); }
  }
}
