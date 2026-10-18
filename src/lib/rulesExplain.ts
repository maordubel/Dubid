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
import { tr } from './i18n/dict.ts';

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
    GK: tr('rules.pos.GK'), DEF: tr('rules.pos.DEF'), MID: tr('rules.pos.MID'), FWD: tr('rules.pos.FWD'),
  };
  const byValue = new Map<number, Position[]>();
  for (const pos of ['GK', 'DEF', 'MID', 'FWD'] as Position[]) {
    const v = p.goal[pos];
    byValue.set(v, [...(byValue.get(v) ?? []), pos]);
  }
  for (const [value, list] of [...byValue.entries()].sort((a, b) => b[0] - a[0])) {
    rows.push({
      label: tr('rules.goalPos', { pos: list.map((x) => POS_HE[x]).join(' / ') }),
      value: signed(value),
    });
  }

  if (p.assist) rows.push({ label: tr('rules.assist'), value: signed(p.assist) });

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
      label: all ? tr('rules.cleanSheet') : tr('rules.cleanSheetPos', { pos: list.map((x) => POS_HE[x]).join(' / ') }),
      value: signed(value),
      note: tr('rules.cleanSheetMin', { n: p.cleanSheetMinMinutes }),
    });
  }

  /* ---- דקות. מוצג רק אם הוא באמת פועל. ---- */
  if (p.minutesPlayed) rows.push({ label: tr('rules.appearance'), value: signed(p.minutesPlayed) });
  if (p.minutes60Plus) rows.push({ label: tr('rules.min60'), value: signed(p.minutes60Plus) });

  /* ---- עונשים ---- */
  if (p.yellowCard) rows.push({ label: tr('rules.yellow'), value: signed(p.yellowCard) });
  if (p.redCard) rows.push({ label: tr('rules.red'), value: signed(p.redCard) });
  /* ★ שער עצמי היה חסר מהמסך לגמרי, והמנוע כן קורא אותו.
     משתמש שראה ‎-2‎ בפירוט לא מצא לזה הסבר בשום מקום. */
  if (p.ownGoal) rows.push({ label: tr('rules.ownGoal'), value: signed(p.ownGoal) });

  /* ---- שוער ---- */
  if (p.savesPoints) {
    rows.push({
      label: tr('rules.saves'),
      value: signed(p.savesPoints),
      note: tr('rules.savesPer', { n: p.savesPer }),
    });
  }
  if (p.penaltySaved) rows.push({ label: tr('rules.penSaved'), value: signed(p.penaltySaved) });
  if (p.penaltyMissed) rows.push({ label: tr('rules.penMissed'), value: signed(p.penaltyMissed) });

  const conceded = Object.entries(p.goalsConceded).filter(([, v]) => v);
  if (conceded.length) {
    rows.push({
      label: tr('rules.conceded'),
      value: signed(conceded[0][1] as number),
      note: tr('rules.concededPer', { n: p.goalsConcededPer }),
    });
  }

  /* ---- תוצאת הקבוצה ---- */
  const rb = rules.resultBonus;
  /* ★ ההסתייגות הזו הייתה חסרה, והיא משנה אסטרטגיה:
     `requireMinutes: 0` פירושו שגם שחקן שלא ירד למגרש מקבל את
     הבונוס. בלי המשפט הזה, "ספסלן זול מקבוצה חזקה" נראה כמו
     טריק שהמערכת לא התכוונה אליו — במקום כלל גלוי. */
  const resultNote = rb.requireMinutes > 0
    ? tr('rules.resultMin', { n: rb.requireMinutes })
    : tr('rules.resultAny');
  if (rb.W) rows.push({ label: tr('rules.win'), value: signed(rb.W, true), note: resultNote });
  if (rb.D) rows.push({ label: tr('rules.draw'), value: signed(rb.D, true), note: resultNote });
  if (rb.L) rows.push({ label: tr('rules.loss'), value: signed(rb.L, true) });

  /* ---- שער וירטואלי ---- */
  const vg = rules.virtualGoal;
  if (vg.points) {
    rows.push({
      label: tr('rules.virtual', { n: vg.goalsPerVirtual }),
      value: signed(vg.points, true),
      note: vg.aggregation === 'pooled'
        ? tr('rules.virtualPooled')
        : tr('rules.virtualPerTeam'),
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
      ? tr('rules.capAll', { n: c.multiplier })
      : tr('rules.capPersonal', { n: c.multiplier }),
  });

  if (c.immunity.yellowCards) {
    rows.push({
      label: tr('rules.immunity'),
      value: '',
      note: tr('rules.immunityBase', { n: c.immunity.minMinutes }) +
        (c.immunity.requireResultIn.length < 3
          ? tr('rules.immunityNoLoss')
          : '.') +
        (c.immunity.redCards ? '' : tr('rules.immunityRed')),
    });
  }

  if (c.transferToViceIfMinutesBelow > 0) {
    rows.push({
      label: tr('rules.vice'),
      value: '',
      /* ★ "אם הסגן שיחק" היה חסר. קפטן שלא ירד וגם סגן שלא ירד
         פירושם **אין מכפיל בכלל** — וזה בדיוק המחזור שבו משתמש
         מרגיש שהמערכת אכלה לו נקודות. */
      note: tr('rules.viceNote', { n: c.transferToViceIfMinutesBelow }),
    });
  }

  if (!c.applyToNegative) {
    rows.push({
      label: '',
      value: '',
      note: tr('rules.capNegative'),
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
    label: tr('rules.diffTier', { pct: Math.round(t.maxSelectionPct * 100) }),
    value: `+${t.points}`,
  }));

  rows.push({
    label: tr('rules.diffCond'),
    value: '',
    note: tr('rules.diffCondNote', { n: d.minPlayerPoints }),
  });
  rows.push({
    label: tr('rules.diffCap'),
    value: '',
    note: tr('rules.diffCapNote', { n: d.maxPerLineup }),
  });
  rows.push({
    label: tr('rules.diffOff'),
    value: '',
    note: tr('rules.diffOffNote', { n: d.minEntriesForStats }),
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
    tr('rules.tb.total'),
    tr('rules.tb.captain'),
    tr('rules.tb.diff'),
    tr('rules.tb.goals'),
    tr('rules.tb.assists'),
    tr('rules.tb.cleanSheets'),
    ...(otherLive ? [tr('rules.tb.other')] : []),
    tr('rules.tb.time'),
  ];
}
