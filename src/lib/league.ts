/**
 * lib/league.ts — איזו ליגה המשתמש משחק.
 *
 * ★ ערך שמור = ליגה **לא-ראשית** בלבד. בחירה בליגה הראשית (ישראל) מוחקת
 *   את המפתח, ולכן משתמש קיים לא רואה שום שינוי והשרת ממשיך לענות
 *   «בלי פרמטר = הראשית».
 * ★ המפתח `ui.league` בלי הקידומת `dubid.` — כדי שלא יימחק ב-purge.
 * ★ החלפת ליגה = רענון דף. מצב המשחק במודולים (סגלים, לוח, הרכב) הוא
 *   סינגלטון; ריענון הוא הדרך היחידה שמבטיחה שאף שריד של ליגה אחת לא נשאר
 *   על מסך של השנייה.
 */
import { supabase } from './supabase.ts';
import type { Locale } from './i18n/locales.ts';

const KEY = 'ui.league';

export function selectedLeague(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    return v && /^[A-Z0-9_]{2,32}$/.test(v) ? v : null;
  } catch { return null; }
}

export function chooseLeague(code: string | null, primary: boolean): void {
  try {
    if (!code || primary) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, code);
  } catch { /* מצב פרטי */ }
  window.location.reload();
}

export interface PublicLeague {
  code: string;
  country: string;
  locale: Locale;
  dir: 'rtl' | 'ltr';
  timezone: string;
  names: Partial<Record<Locale, { full?: string }>>;
  primary: boolean;
  currentGameweek: string | null;
}

export async function fetchLeagues(): Promise<PublicLeague[]> {
  const { data, error } = await supabase.rpc('leagues_public');
  if (error || !Array.isArray(data)) return [];
  return data as PublicLeague[];
}

export function leagueName(l: Pick<PublicLeague, 'names'>, locale: Locale): string {
  return l.names?.[locale]?.full ?? l.names?.en?.full ?? l.names?.he?.full ?? '';
}
