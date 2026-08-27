/**
 * useLineup.ts — מצב ההרכב שבבנייה.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ מה השתנה: הטיוטה עברה לשרת
 * ═══════════════════════════════════════════════════════════════
 *
 * הקובץ הזה שמר את הטיוטה ב-`localStorage`. ההצדקה שנכתבה כאן
 * הייתה "משתמש שנוסע ברכבת ומאבד רשת לא מאבד את העבודה" — נכונה,
 * ומחיר: הטיוטה נשארה **על המכשיר**. מי שהתחיל בטלפון והמשיך
 * במחשב התחיל מאפס, ומי שניקה דפדפן איבד הכל.
 *
 * עכשיו הטיוטה יושבת ב-`game.lineup_drafts`, ומגיעה לכל מכשיר
 * שבו אותו אדם מחובר.
 *
 * ★ מה נשמר מהעיצוב הקודם
 *
 * המצב עדיין חי בזיכרון של הדף, וכל עריכה מיידית. השמירה היא
 * **write-behind**: היא רודפת אחרי המצב, לא חוסמת אותו. מסך
 * שמחכה לשרת בין לחיצה ללחיצה אינו מסך של משחק.
 *
 * ★ ומה **לא** נשמר: אין יותר עותק מקומי, גם לא כגיבוי.
 *   עותק מקומי שמנצח את השרת הוא בדיוק הבאג שהמעבר בא לפתור:
 *   טיוטה ישנה ממכשיר אחד שדורסת חדשה ממכשיר שני.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { validateLineup, teamsUsed } from '../lib/scoring/validate.ts';
import { changeFormation, createEmptyLineup } from '../lib/lineup.ts';
import { fetchDrafts, draftInto, draftFormation, pushDraft, dropDraft,
  type Mode } from '../lib/drafts.ts';
import type { RuleSet } from '../lib/scoring/rules.ts';
import type { Lineup, Position } from '../lib/scoring/types.ts';

export { createEmptyLineup };

export interface AssignablePlayer {
  id: string;
  teamId: string;
  position: Position;
}

/**
 * ★ למה 800 מילישניות
 *
 * זה הפרש שגדול מספיק כדי שסדרת לחיצות רצופה (בחירת חמישה
 * שחקנים) תיסגר לשמירה אחת, וקטן מספיק שמי שסוגר את הטאב מיד
 * אחרי בחירה אחת עדיין יגלה אותה במכשיר השני.
 */
const SAVE_DELAY_MS = 800;

export function useLineup(formation: string, rules: RuleSet, meta: {
  lineupId: string; userId: string; gameweekId: string; mode: Mode;
}) {
  const [lineup, setLineup] = useState<Lineup>(() =>
    createEmptyLineup(formation, {
      lineupId: meta.lineupId, userId: meta.userId, gameweekId: meta.gameweekId,
    }));

  /** `true` אחרי שהתשובה מהשרת הגיעה — לפני זה אסור לשמור. */
  const loaded = useRef(false);
  const [hydrated, setHydrated] = useState(false);
  /**
   * ★ "לא הצלחתי לקרוא" הוא מצב נפרד מ"אין טיוטה".
   *   המסך חייב להבדיל ביניהם: הראשון אומר "אל תיגע, אתה עלול
   *   לדרוס", השני אומר "בבקשה, תתחיל".
   */
  const [loadFailed, setLoadFailed] = useState(false);

  /* ---------------------------------------------------------------- *
   * טעינה
   *
   * ★ הטעינה חייבת לקרות לפני השמירה הראשונה, אחרת מרוץ:
   *   ההרכב הריק שנוצר ברינדור הראשון היה נשמר לשרת ומוחק את
   *   הטיוטה האמיתית לפני שהיא הספיקה לחזור.
   * ---------------------------------------------------------------- */
  useEffect(() => {
    let alive = true;
    loaded.current = false;
    setHydrated(false);
    setLoadFailed(false);

    /* ★ בלי זהות אין טיוטה — ואין למי לשמור אותה.
       `save_draft` דורש `auth.uid()`, ולכן קריאה לפני שהזהות
       הגיעה היא סיבוב סרק שמסתיים ב-`AUTH_REQUIRED`. חשוב מזה:
       היא הייתה פותחת את השמירה מוקדם מדי. */
    if (!meta.userId) return;

    void (async () => {
      const status = await fetchDrafts(meta.userId, meta.gameweekId);
      if (!alive) return;

      /* ★★ כישלון קריאה **לא** פותח את השמירה. ★★
       *
       * זה היה באג הרסני: `fetchDrafts` בלע כל שגיאה והחזיר
       * "אין טיוטה", והקוד כאן סימן `loaded = true` בכל מקרה.
       * תקלת רשת חולפת במחשב הציגה הרכב ריק, המשתמש נגע במשבצת
       * אחת — והשמירה דרסה את אחת־עשרה הבחירות שנבנו בטלפון.
       *
       * עכשיו: שגיאה משאירה את השמירה **סגורה**. המשתמש יראה
       * הודעה, ולא יאבד כלום. */
      if (status === 'error') {
        setLoadFailed(true);
        return;
      }

      // ★ המערך של הטיוטה מנצח, והוא נקרא **לפני** בניית ההרכב
      //   הריק: משבצות שנבנו לפי 4-3-3 לא יכולות לקלוט טיוטה
      //   של 3-5-2 בלי לאבד שחקן.
      const saved = draftFormation(meta.userId, meta.gameweekId, meta.mode);
      const base = createEmptyLineup(saved || formation, {
        lineupId: meta.lineupId, userId: meta.userId, gameweekId: meta.gameweekId,
      });
      const restored = draftInto(base, meta.userId, meta.gameweekId, meta.mode);
      setLineup(restored ?? base);

      loaded.current = true;
      setHydrated(true);
    })();

    return () => { alive = false; };
    // `userId` בתלויות: החלפת זהות (אורח → מחובר) חייבת לטעון
    // מחדש, אחרת המסך מציג את הטיוטה של הזהות הקודמת.
  }, [meta.gameweekId, meta.lineupId, meta.mode, meta.userId, formation]);

  /* ---------------------------------------------------------------- *
   * שמירה — רודפת אחרי המצב, לא חוסמת אותו
   * ---------------------------------------------------------------- */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!loaded.current) return;

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setSaving(true);
      void pushDraft(meta.gameweekId, meta.mode, lineup).then((ok) => {
        setSaving(false);
        if (ok) setSavedAt(Date.now());
      });
    }, SAVE_DELAY_MS);

    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [lineup, meta.gameweekId, meta.mode]);

  /**
   * ★ שמירה מיידית ביציאה מהדף.
   *
   * בלי זה, מי שבחר שחקן וסגר את הטאב תוך פחות מ-800 מילישניות
   * איבד את הבחירה — וזה נראה בדיוק כמו "האפליקציה לא שומרת".
   */
  useEffect(() => {
    const flush = () => {
      if (!loaded.current || document.visibilityState !== 'hidden') return;
      if (timer.current) clearTimeout(timer.current);
      void pushDraft(meta.gameweekId, meta.mode, lineup);
    };
    document.addEventListener('visibilitychange', flush);
    return () => document.removeEventListener('visibilitychange', flush);
  }, [lineup, meta.gameweekId, meta.mode]);

  /* ---------------------------------------------------------------- *
   * עריכה
   * ---------------------------------------------------------------- */
  const assign = useCallback((slotNo: number, player: AssignablePlayer) => {
    setLineup((prev) => ({
      ...prev,
      slots: prev.slots.map((s) =>
        s.slotNo === slotNo ? { ...s, playerId: player.id, teamId: player.teamId } : s,
      ),
    }));
  }, []);

  const clear = useCallback((slotNo: number) => {
    setLineup((prev) => ({
      ...prev,
      slots: prev.slots.map((s) =>
        s.slotNo === slotNo
          ? { ...s, playerId: '', teamId: '', isCaptain: false, isVice: false }
          : s,
      ),
    }));
  }, []);

  /** קפטן אחד בלבד. לחיצה על הקפטן הנוכחי מבטלת. */
  const setCaptain = useCallback((playerId: string) => {
    setLineup((prev) => {
      const already = prev.slots.some((s) => s.playerId === playerId && s.isCaptain);
      return {
        ...prev,
        slots: prev.slots.map((s) => ({
          ...s,
          isCaptain: !already && s.playerId === playerId,
          // מי שהופך לקפטן מפסיק להיות סגן
          isVice: s.isVice && s.playerId !== playerId,
        })),
      };
    });
  }, []);

  const setVice = useCallback((playerId: string) => {
    setLineup((prev) => {
      const already = prev.slots.some((s) => s.playerId === playerId && s.isVice);
      return {
        ...prev,
        slots: prev.slots.map((s) => ({
          ...s,
          isVice: !already && s.playerId === playerId && !s.isCaptain,
        })),
      };
    });
  }, []);

  const reset = useCallback(() => {
    setLineup(createEmptyLineup(formation, {
      lineupId: meta.lineupId, userId: meta.userId, gameweekId: meta.gameweekId,
    }));
    // ★ "התחל מחדש" מוחק גם בשרת. בלי זה הטיוטה הישנה הייתה
    //   חוזרת ברענון הבא, והמשתמש היה רואה את מה שמחק.
    void dropDraft(meta.userId, meta.gameweekId, meta.mode);
  }, [formation, meta.lineupId, meta.userId, meta.gameweekId, meta.mode]);

  /**
   * מעבר מערך. מחזיר את השחקנים שנפלו, כדי שה-UI יוכל לומר
   * "הורדנו מגן אחד" במקום שהם ייעלמו בשקט.
   */
  const [lastDropped, setLastDropped] = useState<string[]>([]);
  const setFormation = useCallback((next: string) => {
    setLineup((prev) => {
      if (prev.formation === next) return prev;
      const result = changeFormation(prev, next);
      setLastDropped(result.dropped);
      return result.lineup;
    });
  }, []);

  const issues = useMemo(() => validateLineup(lineup, rules), [lineup, rules]);
  const usedTeams = useMemo(() => teamsUsed(lineup), [lineup]);
  const filled = lineup.slots.filter((s) => s.playerId).length;

  return {
    lineup, assign, clear, setCaptain, setVice, reset, setFormation, lastDropped,
    issues, usedTeams, filled,
    isComplete: issues.length === 0,
    /** מצב הסנכרון — למסך שרוצה להראות "נשמר". */
    saving, savedAt, hydrated,
    /** `true` = הטיוטה לא נקראה. עריכה עלולה לדרוס. */
    loadFailed,
  };
}
