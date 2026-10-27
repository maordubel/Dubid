/**
 * lib/previousLineup.ts — "Use last round's lineup" (H04).
 *
 * ★ קריאה: `game.my_previous_lineup` — רק ההרכב של auth.uid(), אותה ליגה/עונה/מצב,
 *   מחזור שננעל לפני היעד. לא טיוטה, לא הגשה שנמשכה, לא של אחר.
 * ★ החלה: תמיד לטיוטה (save_draft הקיים), אף פעם לא submit.
 * ★ הבדיקה כאן היא מול נתוני **היעד**: מועדון, עמדה ומחיר של היום, לא של אז.
 *   אין החלפה אוטומטית: מה שלא תקין מסומן, והמשתמש מחליט.
 */
import { supabase } from './supabase.ts';
import { createEmptyLineup } from './lineup.ts';
import type { RuleSet } from './scoring/rules.ts';
import type { Lineup, Position } from './scoring/types.ts';

export interface PreviousLineup {
  sourceCode: string;
  sourceNumber: number;
  mode: 'five' | 'full';
  formation: string;
  slots: Array<{ slotNo: number; playerId: string; teamId: string; position: Position; isCaptain: boolean; isVice: boolean }>;
}

export type PreviousLoad = { status: 'none' } | { status: 'ready'; data: PreviousLineup } | { status: 'error' };

export async function fetchPreviousLineup(gwCode: string, mode: 'five' | 'full'): Promise<PreviousLoad> {
  try {
    const { data, error } = await supabase.rpc('my_previous_lineup', { p_gw_code: gwCode, p_mode: mode });
    if (error) return { status: 'error' };
    const d = data as PreviousLineup | null;
    return d && Array.isArray(d.slots) && d.slots.length > 0 ? { status: 'ready', data: d } : { status: 'none' };
  } catch {
    return { status: 'error' };
  }
}

export interface PoolInfo { id: string; teamId: string; position: Position; price?: number; name: string; status?: 'injured' | 'suspended' }

export type NeedReason = 'gone' | 'position' | 'club' | 'captain' | 'vice' | 'budget' | 'formation';
export interface Need { reason: NeedReason; playerId?: string; name?: string; detail?: string }

export interface CopyPlan {
  lineup: Lineup;
  kept: number;
  size: number;
  /** דברים שמחייבים החלטה לפני הגשה. */
  needs: Need[];
  /** פצוע/מורחק — נשאר בהרכב (כלל המוצר), רק אזהרה. */
  warnings: Array<{ playerId: string; name: string; status: 'injured' | 'suspended' }>;
  spent?: number;
  overBudget?: number;
}

export function planCopy(
  src: PreviousLineup,
  target: { lineupId: string; userId: string; gameweekId: string; currentFormation: string },
  pool: ReadonlyMap<string, PoolInfo>,
  rules: RuleSet,
  budget?: number,
): CopyPlan {
  const needs: Need[] = [];
  const warnings: CopyPlan['warnings'] = [];
  const allowed = rules.constraints.formationAllowed;
  const formation = allowed.includes(src.formation) ? src.formation : target.currentFormation;
  if (formation !== src.formation) needs.push({ reason: 'formation', detail: `${src.formation}→${formation}` });

  const lineup = createEmptyLineup(formation, {
    lineupId: target.lineupId, userId: target.userId, gameweekId: target.gameweekId,
  });
  const free = (pos: Position) => lineup.slots.find((s) => s.position === pos && !s.playerId);
  const seen = new Set<string>();
  let captainKept = false;
  let viceKept = false;

  for (const s of src.slots) {
    if (seen.has(s.playerId)) continue;
    seen.add(s.playerId);
    const p = pool.get(s.playerId);
    if (!p) { needs.push({ reason: 'gone', playerId: s.playerId }); continue; }
    const slot = free(p.position);
    if (!slot) { needs.push({ reason: 'position', playerId: p.id, name: p.name, detail: p.position }); continue; }
    slot.playerId = p.id;
    slot.teamId = p.teamId;                       // ★ המועדון של היום
    slot.isCaptain = !!s.isCaptain && !captainKept;
    slot.isVice = !!s.isVice && !s.isCaptain && !viceKept;
    if (slot.isCaptain) captainKept = true;
    if (slot.isVice) viceKept = true;
    if (p.status) warnings.push({ playerId: p.id, name: p.name, status: p.status });
  }

  // מכסת מועדון — לא בוחרים בשביל המשתמש; מסמנים
  const byTeam = new Map<string, string[]>();
  for (const sl of lineup.slots) if (sl.playerId) byTeam.set(sl.teamId, [...(byTeam.get(sl.teamId) ?? []), sl.playerId]);
  for (const ids of byTeam.values()) {
    if (ids.length > rules.constraints.maxPlayersPerTeam) {
      needs.push({ reason: 'club', detail: ids.map((id) => pool.get(id)?.name ?? id).join(', ') });
    }
  }
  if (rules.constraints.requireCaptain && !captainKept) needs.push({ reason: 'captain' });
  if (src.slots.some((s) => s.isVice) && !viceKept) needs.push({ reason: 'vice' });

  const kept = lineup.slots.filter((s) => s.playerId).length;
  let spent: number | undefined;
  let overBudget: number | undefined;
  if (budget !== undefined) {
    spent = lineup.slots.reduce((sum, s) => sum + (s.playerId ? pool.get(s.playerId)?.price ?? 0 : 0), 0);
    if (spent > budget + 1e-9) { overBudget = +(spent - budget).toFixed(2); needs.push({ reason: 'budget', detail: overBudget.toFixed(1) }); }
  }
  return { lineup, kept, size: lineup.slots.length, needs, warnings, spent, overBudget };
}
