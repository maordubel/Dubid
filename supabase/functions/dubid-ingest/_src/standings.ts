/**
 * dubid-ingest/_src/standings.ts — טבלת הליגה הרשמית מ-365scores.
 *
 * ★ למה מהספק ולא מחושבת: המסד מכיר רק מחזורים מאז שהליגה חוברה
 *   (אנגליה ממחזור 8). טבלה מחושבת מהם אומרת "שוחקו: 2" לקבוצה ששיחקה 9 —
 *   טבלה שגויה, לא חסרה.
 *
 * ★ המתאם שמרני: שורה שחסר בה מספר אחד נזרקת, ו-`game.ingest_set_standings`
 *   מסרב לכתוב טבלה שלא כל הקבוצות בה (ולא כל שורה ממופה). כלומר מבנה
 *   תשובה שהשתנה מוביל ל"אין טבלה" — לעולם לא לטבלה שגויה.
 *
 * שם שדה של הספק מופיע רק כאן.
 */

export interface StandingRow {
  teamProviderId: string;
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  form: string | null;
}

const int = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) ? v
  : typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v.trim())
  : null;

const first = (row: any, keys: string[]): number | null => {
  for (const k of keys) {
    const n = int(row?.[k]);
    if (n !== null) return n;
  }
  return null;
};

/** 365: 1 = ניצחון, 2 = הפסד, 0/3 = תיקו בחלק מהגרסאות — לא מנחשים: רק אותיות מפורשות. */
function formOf(row: any): string | null {
  const f = row?.form ?? row?.recentFormString;
  if (typeof f === 'string' && /^[WDL]{1,10}$/.test(f)) return f;
  return null;
}

/**
 * בוחר את טבלת הליגה מתוך התשובה: הטבלה של המתחרה המבוקש, ואם יש כמה
 * (שלבים/בתים) — זו עם הכי הרבה שורות. ליגה שמתפצלת לפלייאוף תיתן טבלה
 * חלקית → המסד ידחה אותה → המסך מסתיר את המדור. זה הכוונה.
 */
export function parse365Standings(payload: any, competitionId?: number): StandingRow[] {
  const tables: any[] = Array.isArray(payload?.standings) ? payload.standings : [];
  const candidates = tables.filter((t) =>
    Array.isArray(t?.rows) && (competitionId === undefined
      || t?.competitionId === undefined || int(t.competitionId) === competitionId));
  if (candidates.length === 0) return [];
  const table = candidates.reduce((a, b) => (b.rows.length > a.rows.length ? b : a));

  const out: StandingRow[] = [];
  for (const row of table.rows) {
    const id = row?.competitor?.id ?? row?.competitorId;
    if (id === undefined || id === null || String(id) === '') continue;
    const r: StandingRow = {
      teamProviderId: String(id),
      position:     first(row, ['position', 'pos']) ?? -1,
      played:       first(row, ['gamePlayed', 'gamesPlayed', 'played']) ?? -1,
      won:          first(row, ['gamesWon', 'won']) ?? -1,
      drawn:        first(row, ['gamesEven', 'gamesDrawn', 'draws', 'drawn']) ?? -1,
      lost:         first(row, ['gamesLost', 'lost']) ?? -1,
      goalsFor:     first(row, ['for', 'goalsFor', 'scoreFor']) ?? -1,
      goalsAgainst: first(row, ['against', 'goalsAgainst', 'scoreAgainst']) ?? -1,
      points:       first(row, ['points', 'pts']) ?? Number.NaN,
      form: formOf(row),
    };
    const counts = [r.position, r.played, r.won, r.drawn, r.lost, r.goalsFor, r.goalsAgainst];
    if (counts.some((n) => n < 0) || !Number.isFinite(r.points)) continue;
    if (r.won + r.drawn + r.lost !== r.played || r.position < 1) continue;
    out.push(r);
  }
  return out.sort((a, b) => a.position - b.position);
}

export function standingsUrl(competitionId: number): string {
  return `https://webws.365scores.com/web/standings/?appTypeId=5&langId=1&timezoneName=UTC&competitions=${competitionId}`;
}
