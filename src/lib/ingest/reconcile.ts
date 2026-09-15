/**
 * src/lib/ingest/reconcile.ts — מה קורה כששני מקורות לא מסכימים.
 *
 * ★ למה בכלל שני מקורות
 *
 * מקור יחיד הוא נקודת כשל יחידה בשני מובנים: הוא יכול ליפול,
 * והוא יכול **לטעות בשקט**. הראשון מורגש מיד; השני מתגלה רק
 * כשמשתמש סופר נקודות ידנית ומגלה שהשער של השחקן שלו נעלם.
 *
 * הכלל: המקור הראשי הוא זה שכותב. המקור המשני לא מתקן אותו —
 * הוא **חולק עליו**, וחילוקי דעות על תוצאה חוסמים פרסום.
 * המערכת אף פעם לא בוחרת לבד מי צודק.
 */
import type { Alert, Fixture } from './types.ts';

/** התאמת משחקים בין שני מקורות — לפי צמד הקבוצות, לא לפי מזהה. */
function keyOf(f: Fixture): string {
  const norm = (s: string | null | undefined) =>
    (s ?? '').toLowerCase().replace(/[^a-z֐-׿]/g, '');
  return [norm(f.home.nameEn) || norm(f.home.nameHe),
          norm(f.away.nameEn) || norm(f.away.nameHe)].join('|');
}

export interface Reconciliation {
  alerts: Alert[];
  /** כמה משחקים נבדקו בפועל בשני המקורות */
  compared: number;
  agreed: number;
}

export function reconcileFixtures(primary: Fixture[], backup: Fixture[]): Reconciliation {
  const alerts: Alert[] = [];
  const byKey = new Map(backup.map((f) => [keyOf(f), f]));
  let compared = 0;
  let agreed = 0;

  for (const p of primary) {
    const b = byKey.get(keyOf(p));
    if (!b) continue;

    /* משווים רק כששני הצדדים מכריזים "הסתיים" ויש תוצאה.
       מקור שעדיין מציג משחק חי אינו "חולק" — הוא מאחר. */
    const bothFinal = p.status === 'finished' && b.status === 'finished';
    const bothScored = p.homeGoals !== null && p.homeGoals !== undefined
      && b.homeGoals !== null && b.homeGoals !== undefined;
    if (!bothFinal || !bothScored) continue;

    compared += 1;
    if (p.homeGoals === b.homeGoals && p.awayGoals === b.awayGoals) {
      agreed += 1;
      continue;
    }

    alerts.push({
      kind: 'source_disagreement',
      severity: 'block',
      detail: {
        match: p.providerId,
        teams: `${p.home.nameEn ?? p.home.nameHe} – ${p.away.nameEn ?? p.away.nameHe}`,
        primary: `${p.homeGoals}-${p.awayGoals}`,
        backup: `${b.homeGoals}-${b.awayGoals}`,
      },
    });
  }

  return { alerts, compared, agreed };
}

/**
 * שמות בעברית מהמקור המשני, לפי צמד הקבוצות.
 *
 * ★ זה מה שהופך "Osher Davida" ל"אושר דוידה" בלי טרנסליטרציה.
 *   טרנסליטרציה היא ניחוש; חיבור לפי קבוצה ומספר חולצה הוא עובדה.
 */
export function hebrewByShirt(
  rows: Array<{ teamProviderId: string; shirt: number | null; nameHe: string | null }>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) {
    if (r.shirt === null || !r.nameHe) continue;
    out.set(`${r.teamProviderId}#${r.shirt}`, r.nameHe);
  }
  return out;
}
