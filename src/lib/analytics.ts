/**
 * lib/analytics.ts — מתאם מדידה יחיד (D15).
 *
 * ★ רשימת אירועים סגורה + רשימת שדות מותרת לכל אירוע. כל שדה אחר נזרק, כך שלא
 *   יכולים לדלוף טוקנים, אימיילים, שמות, קודי הזמנה או הרכבים לאנליטיקה חיצונית.
 * ★ לעולם לא זורק ולא חוסם משחק: gtag חסר/חסום/שגיאה = no-op.
 * ★ אירועי המרה (submitted / arena_joined) נרשמים רק אחרי אישור שרת — הקורא אחראי.
 */
export const ANALYTICS_EVENTS = {
  league_selected:       ['league_code', 'source'],
  mode_selected:         ['league_code', 'mode', 'source'],
  lineup_started:        ['league_code', 'mode', 'gameweek_code'],
  lineup_ready:          ['mode', 'elapsed_seconds'],
  lineup_submit_attempted: ['league_code', 'mode', 'gameweek_code'],
  lineup_submitted:      ['league_code', 'mode', 'gameweek_code'],
  lineup_submit_failed:  ['mode', 'error_code'],
  arena_joined:          ['league_code', 'mode', 'source'],
  recap_viewed:          ['league_code', 'mode', 'gameweek_code'],
  share_started:         ['surface', 'card_type'],
  share_api_resolved:    ['surface'],
  share_downloaded:      ['card_type'],
  next_round_submitted:  ['league_code', 'mode'],
} as const;

export type AnalyticsEvent = keyof typeof ANALYTICS_EVENTS;
type Params = Record<string, string | number | boolean | null | undefined>;

/** ערך מותר: מחרוזת קצרה בטוחה (קוד/enum) או מספר. אין טקסט חופשי. */
function safeValue(v: unknown): string | number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  if (typeof v === 'string' && /^[A-Za-z0-9_.\-]{1,40}$/.test(v)) return v;
  return undefined;
}

export function sanitizeParams(event: AnalyticsEvent, params: Params = {}): Record<string, string | number> {
  const allowed: readonly string[] = ANALYTICS_EVENTS[event];
  const out: Record<string, string | number> = {};
  for (const k of allowed) {
    const v = safeValue(params[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

const sent = new Set<string>();

/** שולח אירוע. `dedupeKey` מונע כפילויות מרנדור חוזר. */
export function track(event: AnalyticsEvent, params: Params = {}, dedupeKey?: string): void {
  try {
    if (!(event in ANALYTICS_EVENTS)) return;
    if (dedupeKey) {
      const k = `${event}:${dedupeKey}`;
      if (sent.has(k)) return;
      sent.add(k);
    }
    const g = (globalThis as { gtag?: (...a: unknown[]) => void }).gtag;
    if (typeof g !== 'function') return;
    g('event', event, sanitizeParams(event, params));
  } catch { /* מדידה לעולם לא שוברת משחק */ }
}

/** נקי לבדיקות. */
export function _resetAnalyticsForTests(): void { sent.clear(); }
