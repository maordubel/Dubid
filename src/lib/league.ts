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
import { track } from './analytics.ts';
import type { Locale } from './i18n/locales.ts';
import { setLeagueTimezone } from './leagueTz.ts';

const KEY = 'ui.league';
const CHOSEN = 'ui.league.chosen';   // ★ הבחירה הוצגה פעם אחת — לא מציגים שוב את שער הליגות

export function selectedLeague(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    return v && /^[A-Z0-9_]{2,32}$/.test(v) ? v : null;
  } catch { return null; }
}

export function hasChosenLeague(): boolean {
  try { return localStorage.getItem(CHOSEN) === '1'; } catch { return true; }
}

export function markLeagueChosen(): void {
  try { localStorage.setItem(CHOSEN, '1'); } catch { /* מצב פרטי */ }
}

export function chooseLeague(code: string | null, primary: boolean): void {
  markLeagueChosen();
  track('league_selected', { league_code: code ?? 'primary', source: 'gate' });
  try {
    if (!code || primary) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, code);
  } catch { /* מצב פרטי */ }
  window.location.reload();
}

export type ReadinessState = 'ready' | 'degraded' | 'blocked' | 'unknown';
/** כשירות פורמט — מחושב בשרת (game.format_readiness). unknown = הלקוח לא הצליח לקרוא. */
export interface FormatReadiness {
  mode: 'five' | 'full';
  state: ReadinessState;
  canSubmit: boolean;
  reasons: string[];
  checkedAt: string;
  dataUpdatedAt: string | null;
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
  /** יש מחזור נוכחי → אפשר להיכנס. אחרת כרטיס «בקרוב». */
  live?: boolean;
  round?: number | null;
  status?: string | null;
  lockAt?: string | null;
  entrants?: number;
  formats?: { five: FormatReadiness; full: FormatReadiness } | null;
}

export async function fetchLeagues(): Promise<PublicLeague[]> {
  const { data, error } = await supabase.rpc('leagues_public');
  if (error || !Array.isArray(data)) return [];
  return data as PublicLeague[];
}

export function leagueName(l: Pick<PublicLeague, 'names'>, locale: Locale): string {
  return l.names?.[locale]?.full ?? l.names?.en?.full ?? l.names?.he?.full ?? '';
}

/** טוען את אזור הזמן של הליגה שנבחרה (או הראשית). כשל = נשארים על הקיים. */
export async function primeLeagueTimezone(): Promise<void> {
  try {
    const all = await fetchLeagues();
    const sel = selectedLeague();
    const l = sel ? all.find((x) => x.code === sel) : all.find((x) => x.primary);
    if (l) setLeagueTimezone(l.timezone);
  } catch { /* תצוגה בלבד */ }
}

/** האם הליגה ניתנת להכנסה: יש מחזור, ולא שני הפורמטים חסומים. unknown/חסר = לא חוסמים. */
export function leagueEnterable(l: Pick<PublicLeague, 'live' | 'currentGameweek' | 'formats'>): boolean {
  if (l.live === false || !l.currentGameweek) return false;
  const f = l.formats;
  if (!f) return true;
  return !(f.five?.state === 'blocked' && f.full?.state === 'blocked');
}
