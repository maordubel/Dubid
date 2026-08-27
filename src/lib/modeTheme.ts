/**
 * lib/modeTheme.ts — לכל מצב משחק יש זהות משלו.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ הבעיה
 * ═══════════════════════════════════════════════════════════════
 *
 * דוביד 5 ודוביד 11 נראו **זהים**. אותו זהב, אותו כרטיס, אותו
 * מגרש. ההבדל היחיד היה מספר במשבצת.
 *
 * זו לא בעיה אסתטית. שני מצבי משחק שנראים אותו דבר נחווים כאותו
 * דבר, ואז אין סיבה לשחק בשניהם — וכל מה שנבנה בשביל העומק של
 * 11 מת בגלל שאף אחד לא הרגיש שהוא נכנס למקום אחר.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ ההחלטה: אותו מותג, שני מגרשים
 * ═══════════════════════════════════════════════════════════════
 *
 * הזהב נשאר **הקו** — הוא הלוגו, הוא המותג, והוא לא זז. מה
 * שמשתנה הוא **המשטח שהקו יושב עליו**:
 *
 *   דוביד 5   →  אספלט וזרקור. משחק רחוב, מהיר, בלילה.
 *                נחושת חמה (`#C9613A`) — הצבע של תאורת נתרן
 *                על מגרש קטן, ושל קופון טוטו ישן.
 *
 *   דוביד 11  →  דשא ואיצטדיון. משחק ליגה, שיטתי, בשבת.
 *                ירוק עמוק (`#1B4630`) — הדשא של פעם, לפני
 *                שהמצלמות הפכו אותו לזרחני.
 *
 * שני הצבעים נלקחו מאותו עולם: כדורגל ישראלי של שנות השמונים.
 * לא מפלטה גנרית, ולא משני צבעים "משלימים".
 *
 * ★ למה זה לא סתם שני צבעים
 *
 * לכל מצב יש גם: סמל משלו, שם קוד, משפט, מרקם רקע, וקצב.
 * ההבדל צריך להיות מורגש לפני שקוראים מילה.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ הקובץ טהור
 * ═══════════════════════════════════════════════════════════════
 *
 * אין כאן DOM, אין React, ואין `Date.now()`. הוא נבדק במלואו.
 * כל מסך שצריך "איך נראה מצב X" שואל כאן — ואין hex אחד שכתוב
 * פעמיים בשני מסכים.
 */

export type ModeId = 'five' | 'full';

export interface ModeTheme {
  id: ModeId;

  /* ---- שם ---- */
  /** השם המסחרי. */
  name: string;
  /** שם הקוד — קצר, נוסטלגי, נדבק. מופיע בתגים ובכרטיס השיתוף. */
  codeName: string;
  /** משפט אחד שאומר מה המצב הזה דורש ממך. */
  tagline: string;
  /** משפט האווירה — לכרטיס הפתיחה של המצב. */
  atmosphere: string;

  /* ---- צבע ---- */
  /** הצבע הראשי של המצב. hex, לשימוש גם בקנבס של כרטיס השיתוף. */
  accent: string;
  /** גרסה כהה — לרקעים ולמסגרות. */
  accentDeep: string;
  /** גרסה בהירה — לטקסט על כהה. */
  accentLight: string;
  /** צבע המשטח שעליו המצב יושב. */
  surface: string;

  /* ---- מבנה ---- */
  lineupSize: number;
  /** תקציב במיליונים, או `null` אם אין. */
  budget: number | null;

  /* ---- קצב ---- */
  /**
   * כמה זמן לוקח למשתמש להיכנס. מוצג בכרטיס הבחירה.
   * ★ עובדה, לא הבטחה שיווקית: 5 בחירות מול 11.
   */
  entryLabel: string;
}

/**
 * ★ הפלטה. הערכים כאן חייבים להישאר זהים ל-`tailwind.config.ts`
 *   ולפלטה של `shareCard.ts` — שלושתם מציירים את אותו מוצר,
 *   בשלושה מנועים שונים.
 */
export const MODE_THEME: Record<ModeId, ModeTheme> = {
  five: {
    id: 'five',
    name: 'דוביד 5',
    codeName: 'הרחוב',
    tagline: 'בחרו 5. נצחו את כולם.',
    atmosphere: 'חמישה שמות, תקציב אחד, ואפס מקום להתחבא.',
    accent: '#C9613A',
    accentDeep: '#7A3520',
    accentLight: '#E89A6E',
    surface: '#1A100B',
    lineupSize: 5,
    budget: 15,
    entryLabel: 'דקה אחת',
  },
  full: {
    id: 'full',
    name: 'דוביד 11',
    codeName: 'הליגה',
    tagline: 'בנו הרכב. שלטו בליגה.',
    atmosphere: 'אחד־עשר, מערך, קפטן. מי שמכיר את הליגה — מנצח.',
    accent: '#3E8E63',
    accentDeep: '#12301F',
    accentLight: '#78C69A',
    surface: '#0D1A12',
    lineupSize: 11,
    budget: null,
    entryLabel: 'חמש דקות',
  },
};

export function modeTheme(id: ModeId): ModeTheme {
  return MODE_THEME[id];
}

/**
 * משתני ה-CSS של המצב.
 *
 * ★ למה משתנים ולא מחלקות
 *
 * מחלקה לכל מצב (`.mode-five .card { … }`) הייתה מכפילה כל כלל
 * עיצוב בקובץ הסגנונות, ומכריחה כל קומפוננטה חדשה לזכור להוסיף
 * את שני הענפים. משתנה אחד על העוטף — וכל מה שבפנים משתנה יחד,
 * כולל קומפוננטות שייכתבו מחר.
 *
 * שימוש:  <div style={modeVars('five')}>
 * ובתוך:  style={{ borderColor: 'var(--mode-accent)' }}
 *         או `className="border-[color:var(--mode-accent)]"`
 */
export function modeVars(id: ModeId): Record<string, string> {
  const t = MODE_THEME[id];
  return {
    '--mode-accent': t.accent,
    '--mode-accent-deep': t.accentDeep,
    '--mode-accent-light': t.accentLight,
    '--mode-surface': t.surface,
    /* גרדיאנט מוכן — כדי שאף מסך לא יחבר אותו בעצמו וייצא אחרת. */
    '--mode-wash': `linear-gradient(160deg, ${t.accentDeep}55 0%, transparent 62%)`,
    '--mode-glow': `0 0 0 1px ${t.accent}3d, 0 18px 46px -22px ${t.accent}80`,
  };
}

/**
 * ★ המרקם של המצב — שכבת רקע אחת, ב-CSS בלבד.
 *
 * דוביד 5 הוא אספלט: גרעיניות אקראית וזרקור אחד מהצד.
 * דוביד 11 הוא דשא: פסי כיסוח, כמו מגרש אחרי הכנה.
 *
 * שניהם `background-image` טהור. אין תמונה, אין בקשת רשת, ואין
 * קובץ שמישהו יצטרך לתחזק.
 */
export function modeTexture(id: ModeId): Record<string, string> {
  const t = MODE_THEME[id];
  if (id === 'five') {
    return {
      backgroundColor: t.surface,
      backgroundImage: [
        `radial-gradient(120% 80% at 82% -8%, ${t.accent}26, transparent 58%)`,
        'radial-gradient(rgba(255,255,255,.028) .6px, transparent .7px)',
      ].join(','),
      backgroundSize: 'auto, 5px 5px',
    };
  }
  return {
    backgroundColor: t.surface,
    backgroundImage: [
      `radial-gradient(110% 74% at 50% -12%, ${t.accent}22, transparent 62%)`,
      /* פסי כיסוח. 3% ולא יותר — מעל זה זה מגרש, לא רקע. */
      `repeating-linear-gradient(102deg, rgba(255,255,255,.026) 0 26px, transparent 26px 52px)`,
    ].join(','),
    backgroundSize: 'auto, auto',
  };
}

/**
 * שם התג שמוצג ליד ההרכב.
 *
 * ★ "5 מתוך 14 קבוצות" ולא "5 שחקנים": המספר שמעניין הוא כמה
 *   ויתרת, לא כמה בחרת. זה מה שהופך את הבחירה לכואבת — ולכן
 *   למעניינת.
 */
export function modeConstraintLabel(id: ModeId, teamCount: number): string {
  const t = MODE_THEME[id];
  return `${t.lineupSize} מתוך ${teamCount} קבוצות`;
}
