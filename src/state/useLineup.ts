/**
 * useLineup.ts — מצב ההרכב.
 *
 * שמור ב-localStorage: משתמש שנוסע ברכבת ומאבד רשת באמצע בניית ההרכב
 * לא מאבד את העבודה. ההגשה עצמה לעולם לא נשמרת מקומית — רק הטיוטה.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { validateLineup, teamsUsed } from '../lib/scoring/validate.ts';
import { createEmptyLineup } from '../lib/lineup.ts';
import type { RuleSet } from '../lib/scoring/rules.ts';
import type { Lineup, Position } from '../lib/scoring/types.ts';

const STORAGE_KEY = 'dubid.lineup.draft.v1';

export { createEmptyLineup };

export interface AssignablePlayer {
  id: string;
  teamId: string;
  position: Position;
}

export function useLineup(formation: string, rules: RuleSet, meta: {
  lineupId: string; userId: string; gameweekId: string;
}) {
  const [lineup, setLineup] = useState<Lineup>(() => {
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as Lineup;
          // טיוטה של מערך אחר (או של מחזור אחר) לא רלוונטית
          if (saved.formation === formation && saved.gameweekId === meta.gameweekId) return saved;
        }
      } catch { /* טיוטה פגומה — מתחילים נקי */ }
    }
    return createEmptyLineup(formation, meta);
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(lineup)); } catch { /* מצב פרטי */ }
  }, [lineup]);

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
    setLineup(createEmptyLineup(formation, meta));
  }, [formation, meta]);

  const issues = useMemo(() => validateLineup(lineup, rules), [lineup, rules]);
  const usedTeams = useMemo(() => teamsUsed(lineup), [lineup]);
  const filled = lineup.slots.filter((s) => s.playerId).length;

  return {
    lineup, assign, clear, setCaptain, setVice, reset,
    issues, usedTeams, filled,
    isComplete: issues.length === 0,
  };
}
