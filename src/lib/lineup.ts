/**
 * lib/lineup.ts — יצירת הרכב ריק ממערך.
 *
 * טהור בכוונה, בלי React: המנוע, הטסטים וה-Edge Function צריכים את זה
 * בלי לגרור את ספריית ה-UI.
 */
import { parseFormation } from './scoring/validate.ts';
import type { Lineup, LineupSlot, Position } from './scoring/types.ts';

/** סדר המשבצות בהרכב — שוער, הגנה, קישור, התקפה. */
export const SLOT_ORDER: Position[] = ['GK', 'DEF', 'MID', 'FWD'];

export function createEmptyLineup(
  formation: string,
  meta: { lineupId: string; userId: string; gameweekId: string },
): Lineup {
  const counts = parseFormation(formation);
  const slots: LineupSlot[] = [];
  let slotNo = 1;
  for (const position of SLOT_ORDER) {
    for (let i = 0; i < (counts[position] ?? 0); i++) {
      slots.push({ slotNo: slotNo++, playerId: '', teamId: '', position });
    }
  }
  return { ...meta, formation, slots };
}

/* ================================================================== */
/* החלפת מערך                                                          */
/* ================================================================== */

export interface FormationChange {
  lineup: Lineup;
  /** שחקנים שלא הייתה להם עמדה במערך החדש. */
  dropped: string[];
  /** כמה משבצות נותרו ריקות אחרי המעבר. */
  empty: number;
}

/**
 * ★ מעבר בין מערכים שומר כל שחקן שאפשר.
 *
 * הברִיף: "שינוי מערך חייב לשמר שחקנים תקינים שנבחרו, ולסמן
 * בבירור אילו עמדות צריך למלא."
 *
 * למה זה חשוב: משתמש שבנה 11 שחקנים ורוצה לנסות 3-5-2 לא אמור
 * להתחיל מאפס. מעבר מ-4-3-3 ל-3-4-3 מוריד מגן אחד ומוסיף קשר —
 * תשעה שחקנים נשארים במקום, ורק אחד נופל.
 *
 * ★ מי נופל כשיש עודף
 *
 * האחרון שנבחר, ולא הראשון. משתמש זוכר את הבחירות המוקדמות שלו
 * כ"הליבה" ואת האחרונות כ"השלמה" — ולכן הסרת האחרון מפתיעה
 * פחות. `slotNo` יורד מבטיח שזה גם דטרמיניסטי.
 *
 * הקפטן והסגן נשמרים אם השחקן שרד את המעבר.
 */
export function changeFormation(
  current: Lineup,
  formation: string,
  meta?: { lineupId?: string; userId?: string; gameweekId?: string },
): FormationChange {
  const counts = parseFormation(formation);
  const blank = createEmptyLineup(formation, {
    lineupId: meta?.lineupId ?? current.lineupId,
    userId: meta?.userId ?? current.userId,
    gameweekId: meta?.gameweekId ?? current.gameweekId,
  });

  // השחקנים הקיימים, מקובצים לפי עמדה, בסדר יציב
  const byPosition = new Map<Position, LineupSlot[]>();
  for (const slot of [...current.slots].sort((a, b) => a.slotNo - b.slotNo)) {
    if (!slot.playerId) continue;
    const list = byPosition.get(slot.position) ?? [];
    list.push(slot);
    byPosition.set(slot.position, list);
  }

  const dropped: string[] = [];
  const slots = blank.slots.map((slot) => ({ ...slot }));

  for (const position of SLOT_ORDER) {
    const have = byPosition.get(position) ?? [];
    const room = counts[position] ?? 0;

    // עודף — האחרונים שנבחרו יורדים
    if (have.length > room) {
      for (const extra of have.slice(room)) dropped.push(extra.playerId);
    }

    const targets = slots.filter((s) => s.position === position);
    have.slice(0, room).forEach((src, i) => {
      const target = targets[i];
      target.playerId = src.playerId;
      target.teamId = src.teamId;
      target.price = src.price;
      target.isCaptain = src.isCaptain;
      target.isVice = src.isVice;
    });
  }

  // ★ הקפטן אולי נפל. בלי הבדיקה הזו נשארים עם הרכב בלי קפטן
  //   ועם שגיאת ולידציה שהמשתמש לא מבין מאיפה הגיעה.
  if (!slots.some((s) => s.isCaptain)) {
    for (const s of slots) s.isVice = false;
  }

  return {
    lineup: { ...blank, slots },
    dropped,
    empty: slots.filter((s) => !s.playerId).length,
  };
}
