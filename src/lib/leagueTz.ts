/**
 * lib/leagueTz.ts — אזור הזמן להצגת שעות של הליגה הנוכחית (תצוגה בלבד).
 * ★ רגע הנעילה והספירה לאחור תמיד נגזרים מ-ISO/UTC של השרת; כאן רק איך מציגים.
 * מודול בלי תלויות — כדי שגם בדיקות node וגם roundPhase יוכלו לייבא אותו.
 */
let LEAGUE_TZ = 'Asia/Jerusalem';

function validTz(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
}

export function leagueTimezone(): string { return LEAGUE_TZ; }

export function setLeagueTimezone(tz: unknown): void {
  if (validTz(tz)) LEAGUE_TZ = tz;
}
