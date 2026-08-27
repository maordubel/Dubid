/**
 * lib/rulesExplain.ts — מה שכתוב במסך החוקים נגזר מהחוקים.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★★ הבעיה: מסך החוקים שיקר ★★
 * ═══════════════════════════════════════════════════════════════
 *
 * `RulesScreen` החזיק **מערך מוקלד**:
 *
 *     ['בישול', '3'],
 *     ['ניצחון של הקבוצה האמיתית', '+4'],
 *
 * המספרים היו נכונים ביום שנכתבו. משתי סיבות הם לא יכולים
 * להישאר נכונים:
 *
 *  1. **לוח הניהול.** מאז `db/14` אפשר לשנות כל ערך ניקוד
 *     מהמסך, בלי פריסה. ברגע שתשנה בישול ל-4, המשחק ינקד 4
 *     והמסך ימשיך להצהיר 3 — לנצח, ובלי שום סימן.
 *
 *  2. **שני מצבי משחק.** דוביד 5 ודוביד 11 חולקים טבלת ניקוד
 *     אבל לא את כל השאר, ולמסך היה מערך אחד.
 *
 * ★ הפתרון: המסך לא יודע מספרים. הוא מקבל `RuleSet` — **אותו
 *   אובייקט שהמנוע מנקד לפיו** — ושואל אותו.
 *
 * מספר שאי אפשר לשנות בלי לשנות את הניקוד עצמו הוא מספר שלא
 * יכול להתפצל.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ ומה שחשוב לא פחות: כלל כבוי לא מוצג
 * ═══════════════════════════════════════════════════════════════
 *
 * ל-`RuleSet` יש שדות שמכוונים ל-0 בכוונה — הצלות, עצירת פנדל,
 * ספיגות, נקודות הופעה. המנוע קורא אותם ומדלג, ולכן הם **לא
 * מייצרים שורה בפירוט הניקוד ולא משנים אף תוצאה**.
 *
 * שורה בטבלת החוקים שכתוב לידה "0" היא הבטחה שלא תמומש: המשתמש
 * יחשוב שהצלות שוות משהו, יבחר שוער, ולא יבין למה הוא קיבל
 * אפס. לכן חוק באפס פשוט לא מופיע.
 *
 * הקובץ טהור: אין DOM, אין רשת, אין זמן. הוא נבדק במלואו.
 */
import type { RuleSet } from './scoring/rules.ts';
import type { Position } from './scoring/types.ts';
import { DEFAULT_DIFFERENTIAL } from './scoring/ranking.ts';

export interface RuleRow {
  label: string;
  /** מוכן לתצוגה: `6`, `-1`, `+4`. */
  value: string;
  /** מידע משלים בשורה משלו. */
  note?: string;
}

/** `+4` לחיובי, `-1` לשלילי, `6` לניטרלי. */
function signed(n: number, plus = false): string {
  if (n < 0) return String(n);
  return plus ? `+${n}` : String(n);
}

/**
 * טבלת הניקוד, כפי שהיא **באמת**.
 *
 * ★ שערים מקובצים לפי ערך ולא לפי עמדה: כשלשוער ולמגן אותו
 *   מספר, שתי שורות זהות הן רעש. כשהם נפרדים — יופיעו נפרד.
 */
export function scoringRows(rules: RuleSet): RuleRow[] {
  const rows: RuleRow[] = [];
  const p = rules.personal;

  /* ---- שערים, מקובצים לפי ערך ---- */
  const POS_HE: Record<Position, string> = {
    GK: 'שוער', DEF: 'מגן', MID: 'קשר', FWD: 'חלוץ',
  };
  const byValue = new Map<number, Position[]>();
  for (const pos of ['GK', 'DEF', 'MID', 'FWD'] as Position[]) {
    const v = p.goal[pos];
    byValue.set(v, [...(byValue.get(v) ?? []), pos]);
  }
  for (const [value, list] of [...byValue.entries()].sort((a, b) => b[0] - a[0])) {
    rows.push({
      label: `שער — ${list.map((x) => POS_HE[x]).join(' / ')}`,
      value: signed(value),
    });
  }

  if (p.assist) rows.push({ label: 'בישול', value: signed(p.assist) });

  /* ---- שער נקי ---- */
  const clean = new Map<number, Position[]>();
  for (const pos of ['GK', 'DEF', 'MID', 'FWD'] as Position[]) {
    const v = p.cleanSheet[pos];
    if (!v) continue;
    clean.set(v, [...(clean.get(v) ?? []), pos]);
  }
  for (const [value, list] of [...clean.entries()].sort((a, b) => b[0] - a[0])) {
    const all = list.length === 4;
    rows.push({
      label: all ? 'שער נקי' : `שער נקי — ${list.map((x) => POS_HE[x]).join(' / ')}`,
      value: signed(value),
      note: `נדרשות ${p.cleanSheetMinMinutes} דקות משחק ומעלה`,
    });
  }

  /* ---- דקות. מוצג רק אם הוא באמת פועל. ---- */
  if (p.minutesPlayed) rows.push({ label: 'הופעה במשחק', value: signed(p.minutesPlayed) });
  if (p.minutes60Plus) rows.push({ label: '60 דקות ומעלה', value: signed(p.minutes60Plus) });

  /* ---- עונשים ---- */
  if (p.yellowCard) rows.push({ label: 'כרטיס צהוב', value: signed(p.yellowCard) });
  if (p.redCard) rows.push({ label: 'כרטיס אדום', value: signed(p.redCard) });
  /* ★ שער עצמי היה חסר מהמסך לגמרי, והמנוע כן קורא אותו.
     משתמש שראה ‎-2‎ בפירוט לא מצא לזה הסבר בשום מקום. */
  if (p.ownGoal) rows.push({ label: 'שער עצמי', value: signed(p.ownGoal) });

  /* ---- שוער ---- */
  if (p.savesPoints) {
    rows.push({
      label: 'הצלות',
      value: signed(p.savesPoints),
      note: `לכל ${p.savesPer} הצלות`,
    });
  }
  if (p.penaltySaved) rows.push({ label: 'עצירת פנדל', value: signed(p.penaltySaved) });
  if (p.penaltyMissed) rows.push({ label: 'החמצת פנדל', value: signed(p.penaltyMissed) });

  const conceded = Object.entries(p.goalsConceded).filter(([, v]) => v);
  if (conceded.length) {
    rows.push({
      label: 'ספיגות',
      value: signed(conceded[0][1] as number),
      note: `לכל ${p.goalsConcededPer} שערים שנספגו`,
    });
  }

  /* ---- תוצאת הקבוצה ---- */
  const rb = rules.resultBonus;
  /* ★ ההסתייגות הזו הייתה חסרה, והיא משנה אסטרטגיה:
     `requireMinutes: 0` פירושו שגם שחקן שלא ירד למגרש מקבל את
     הבונוס. בלי המשפט הזה, "ספסלן זול מקבוצה חזקה" נראה כמו
     טריק שהמערכת לא התכוונה אליו — במקום כלל גלוי. */
  const resultNote = rb.requireMinutes > 0
    ? `נדרשות ${rb.requireMinutes} דקות משחק`
    : 'ניתן לכל שחקן בהרכב, גם אם לא שיחק';
  if (rb.W) rows.push({ label: 'ניצחון של הקבוצה', value: signed(rb.W, true), note: resultNote });
  if (rb.D) rows.push({ label: 'תיקו של הקבוצה', value: signed(rb.D, true), note: resultNote });
  if (rb.L) rows.push({ label: 'הפסד של הקבוצה', value: signed(rb.L, true) });

  /* ---- שער וירטואלי ---- */
  const vg = rules.virtualGoal;
  if (vg.points) {
    rows.push({
      label: `כל ${vg.goalsPerVirtual} שערים של קבוצות ההרכב`,
      value: signed(vg.points, true),
      note: vg.aggregation === 'pooled'
        ? 'כל השערים לקופה אחת; שארית נשמרת למחזור הבא'
        : 'לכל קבוצה בנפרד; שארית לא נספרת',
    });
  }

  return rows;
}

/* ================================================================== */
/* הקפטן                                                              */
/* ================================================================== */

export function captainRows(rules: RuleSet): RuleRow[] {
  const c = rules.captain;
  const rows: RuleRow[] = [];

  rows.push({
    label: `×${c.multiplier}`,
    value: '',
    note: c.appliesTo === 'personalAndResult'
      ? `הציון של הקפטן מוכפל פי ${c.multiplier}, כולל בונוס התוצאה של הקבוצה שלו.`
      : `הציון האישי של הקפטן מוכפל פי ${c.multiplier}. בונוס התוצאה לא מוכפל.`,
  });

  if (c.immunity.yellowCards) {
    rows.push({
      label: 'חסינות',
      value: '',
      note: `כרטיס צהוב של הקפטן מבוטל אם שיחק ${c.immunity.minMinutes} דקות ומעלה` +
        (c.immunity.requireResultIn.length < 3
          ? ' והקבוצה שלו לא הפסידה.'
          : '.') +
        (c.immunity.redCards ? '' : ' אדום לא נסלח.'),
    });
  }

  if (c.transferToViceIfMinutesBelow > 0) {
    rows.push({
      label: 'סגן',
      value: '',
      /* ★ "אם הסגן שיחק" היה חסר. קפטן שלא ירד וגם סגן שלא ירד
         פירושם **אין מכפיל בכלל** — וזה בדיוק המחזור שבו משתמש
         מרגיש שהמערכת אכלה לו נקודות. */
      note: `אם הקפטן שיחק פחות מ-${c.transferToViceIfMinutesBelow} דקות, ` +
        'הכפולה עוברת לסגן — בתנאי שהסגן עצמו שיחק.',
    });
  }

  if (!c.applyToNegative) {
    rows.push({
      label: '',
      value: '',
      note: 'ציון שלילי לא מוכפל. ההימור מגדיל רווח, לא הפסד.',
    });
  }

  return rows;
}

/* ================================================================== */
/* בחירה נדירה                                                        */
/* ================================================================== */

/**
 * ★ ההסבר הזה היה **שגוי**, ולא רק חסר.
 *
 * המסך אמר: "הבונוס עובד רק אם השחקן באמת הופיע בגיליון".
 * הקוד דורש `subtotal >= minPlayerPoints` — כלומר **נקודות**,
 * לא הופעה. שחקן נדיר ששיחק תשעים דקות והביא 3 נקודות לא מזכה
 * בכלום, והמשתמש היה בטוח שמשהו נשבר.
 *
 * וגם: המדרגות והתקרה — שני הפרטים שקובעים אם בכלל כדאי להמר
 * על בחירה נדירה — לא הופיעו בשום מקום.
 */
export function differentialRows(): RuleRow[] {
  const d = DEFAULT_DIFFERENTIAL;
  const rows: RuleRow[] = d.tiers.map((t) => ({
    label: `עד ${Math.round(t.maxSelectionPct * 100)}% מהמשתתפים בחרו`,
    value: `+${t.points}`,
  }));

  rows.push({
    label: 'תנאי',
    value: '',
    note: `הבונוס ניתן רק אם השחקן צבר ${d.minPlayerPoints} נקודות ומעלה. ` +
      'בחירה נדירה שלא הביאה כלום — לא מזכה.',
  });
  rows.push({
    label: 'תקרה',
    value: '',
    note: `עד ${d.maxPerLineup} נקודות בונוס להרכב אחד.`,
  });
  rows.push({
    label: 'מתי כבוי',
    value: '',
    note: `כשיש פחות מ-${d.minEntriesForStats} משתתפים — אז "נדיר" לא אומר כלום.`,
  });

  return rows;
}

/* ================================================================== */
/* שוברי שוויון                                                       */
/* ================================================================== */

/**
 * ★ הרשימה נגזרת מהמנוע, ומדלגת על שלב שלא יכול להכריע.
 *
 * "שאר התרומה המאומתת" מורכב מהצלות, עצירות פנדל, ודקות — ושלושתם
 * מכוונים ל-0. כלומר השלב הזה **תמיד מחזיר 0** ולעולם לא ישבור
 * שוויון. המסך הבטיח שמונה שלבים; בפועל היו שבעה.
 */
export function tiebreakSteps(rules: RuleSet): string[] {
  const p = rules.personal;
  const otherLive = !!(p.savesPoints || p.penaltySaved || p.minutesPlayed || p.minutes60Plus);

  return [
    'ניקוד כולל',
    'ניקוד הקפטן',
    'תרומת הבחירות הנדירות',
    'שערים של השחקנים שנבחרו',
    'בישולים של השחקנים שנבחרו',
    'שערים נקיים',
    ...(otherLive ? ['שאר התרומה המאומתת'] : []),
    'זמן ההגשה הרשמי — מי שהגיש קודם',
  ];
}
