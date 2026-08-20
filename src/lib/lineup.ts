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
