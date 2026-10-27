/**
 * lib/revisionBus.ts — ערוץ זמן-אמת אחד, מנותב לפי תחום, עם ריסון.
 *
 * ★ מה היה: כל שינוי במסד — כל משפט של הקליטה בכל ליגה, כל הגשה של כל
 *   משתתף — העלה את `game.data_revision`, וכל מכשיר פתוח הריץ על כל אירוע
 *   **שתי** טעינות מלאות: הסגלים, הלוח, החוקים, התוכן והפרסום (8 קריאות,
 *   כולל סגל שלם) + ההגשות והתוצאות (3). מאות אירועים בריצת קליטה אחת.
 *   המונה עבר 1.3 מיליון. זו תעבורה שתוכנית החינם לא מחזיקה.
 * ★ מה עכשיו:
 *   · ערוץ אחד במקום שניים.
 *   · ניתוב לפי `scope` (שם הטבלה שהשתנתה): הגשה לא מושכת סגלים, סטטיסטיקה
 *     לא מושכת תוכן.
 *   · ריסון: רצף אירועים = טעינה אחת בסופו.
 *   · טאב מוסתר לא טוען כלום — מסמן "מלוכלך" וטוען פעם אחת כשחוזרים.
 */
import { supabase } from './supabase.ts';

export type Scope =
  | 'teams' | 'players' | 'squads' | 'gameweeks' | 'weekly_matches' | 'player_match_stats'
  | 'user_lineups' | 'mode_config' | 'scoring_overrides' | 'content' | 'league_standings' | string;

interface Sub {
  scopes: ReadonlySet<string> | null;   // null = הכל
  delayMs: number;
  run: () => void;
  timer: ReturnType<typeof setTimeout> | null;
  dirty: boolean;
}

const subs = new Set<Sub>();
let channel: ReturnType<typeof supabase.channel> | null = null;
let listening = false;

const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

function fire(s: Sub) {
  if (hidden()) { s.dirty = true; return; }
  if (s.timer) clearTimeout(s.timer);
  s.timer = setTimeout(() => { s.timer = null; s.dirty = false; s.run(); }, s.delayMs);
}

function onVisible() {
  if (hidden()) return;
  for (const s of subs) if (s.dirty) fire(s);
}

function dispatch(scope: string) {
  for (const s of subs) if (!s.scopes || s.scopes.has(scope)) fire(s);
}

function ensureChannel() {
  if (channel) return;
  channel = supabase
    .channel('dubid-revision')
    .on('postgres_changes', { event: '*', schema: 'game', table: 'data_revision' },
        (p: { new?: { scope?: string } }) => dispatch(String(p?.new?.scope ?? '')))
    .subscribe();
  if (!listening && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisible);
    listening = true;
  }
}

/** הרשמה לשינויים בתחומים מסוימים. מחזיר ביטול. */
export function onRevision(scopes: readonly string[] | null, run: () => void, delayMs = 3000): () => void {
  const s: Sub = { scopes: scopes ? new Set(scopes) : null, delayMs, run, timer: null, dirty: false };
  subs.add(s);
  ensureChannel();
  return () => {
    if (s.timer) clearTimeout(s.timer);
    subs.delete(s);
    if (subs.size === 0 && channel) {
      void supabase.removeChannel(channel);
      channel = null;
    }
  };
}

/** לבדיקות: הפעלת ניתוב בלי ערוץ אמיתי. */
export function __dispatchForTests(scope: string): void { dispatch(scope); }
