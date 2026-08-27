/**
 * lib/draftWire.ts — התרגום בין ההרכב שעל המסך לזה שבמסד.
 *
 * ★ למה זה קובץ נפרד
 *
 * `lib/drafts.ts` מייבא את לקוח Supabase, ולכן אי אפשר לבדוק
 * אותו ב-Node בלי רשת. התרגום עצמו — המקום שבו באמת אפשר לטעות
 * — הוא **טהור**: מחרוזות ומערכים, בלי DOM ובלי רשת.
 *
 * הפרדה של שלושים שורות קונה בדיקות אמיתיות על החלק שבו טעות
 * שקטה עולה בהרכב שחוזר מעוות.
 *
 * ★ המרווח שהוא מגשר עליו
 *
 *     המסך:  { slotNo: 3, playerId: 'P305', isCaptain: true }
 *     המסד:  { slot_no: 3, ext_player_id: '305', is_captain: true }
 *
 * הקידומת `P` היא של הקליינט; המסד מדבר מספרים.
 */
import type { Lineup, Position } from './scoring/types.ts';

export type Mode = 'full' | 'five';

/** מה שהשרת מחזיק. `ext_player_id` בלי הקידומת `P`. */
export interface WireSlot {
  slot_no: number;
  ext_player_id: string;
  team_id?: string;
  position?: string;
  is_captain?: boolean;
  is_vice?: boolean;
  is_bench?: boolean;
}

export interface WireDraft {
  formation: string;
  slots: WireSlot[];
  updatedAt: string;
}

/**
 * ★ רק משבצות מלאות נשלחות.
 *
 * טיוטה של 11 שבה נבחרו שלושה היא שלוש שורות, לא אחת-עשרה עם
 * שמונה ריקות. המערך (`formation`) הוא מה שמשחזר את המבנה, ולכן
 * שמירת משבצות ריקות היא בייטים בלי מידע.
 */
export function toWire(lineup: Lineup): WireSlot[] {
  return lineup.slots
    .filter((s) => s.playerId)
    .map((s) => ({
      slot_no: s.slotNo,
      // המסד מדבר '305'; הקליינט 'P305'.
      ext_player_id: s.playerId.replace(/^P/i, ''),
      team_id: s.teamId,
      position: s.position,
      is_captain: !!s.isCaptain,
      is_vice: !!s.isVice,
      is_bench: !!s.isBench,
    }));
}

/**
 * מרכיב הרכב מלא מהטיוטה: המשבצות הריקות נבנות מהמערך, והמלאות
 * מוזרקות למקומן.
 *
 * ⚠ `base` הוא הרכב ריק שנבנה מ-`formation` **של הטיוטה**. אם
 *   המשתמש שינה מערך במכשיר אחר, המערך שחוזר הוא החדש — וזה
 *   נכון: הטיוטה שנשמרה אחרונה מנצחת.
 */
export function fromWire(base: Lineup, wire: WireDraft): Lineup {
  const bySlot = new Map<number, WireSlot>();
  for (const s of wire.slots ?? []) bySlot.set(Number(s.slot_no), s);

  return {
    ...base,
    formation: wire.formation || base.formation,
    slots: base.slots.map((slot) => {
      const w = bySlot.get(slot.slotNo);
      if (!w) return slot;
      return {
        ...slot,
        playerId: `P${String(w.ext_player_id).replace(/^P/i, '')}`,
        teamId: w.team_id ?? slot.teamId,
        position: (w.position as Position) ?? slot.position,
        isCaptain: !!w.is_captain,
        isVice: !!w.is_vice,
        isBench: !!w.is_bench,
      };
    }),
  };
}

