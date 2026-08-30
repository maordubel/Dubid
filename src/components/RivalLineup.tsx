/**
 * components/RivalLineup.tsx — ההרכב של מישהו אחר.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ למה המסך הזה קיים
 * ═══════════════════════════════════════════════════════════════
 *
 * הברִיף מגדיר את הלולאה כ-
 *
 *      PLAY → WATCH → RESULT → **COMPARE** → RETURN
 *
 * ו-COMPARE הייתה החוליה היחידה שלא הייתה במוצר. הטבלה הראתה
 * שם, מספר, ומקום — ולא הראתה **למה**. מי שראה מישהו עם 12
 * נקודות יותר ממנו לא יכול היה לדעת אם זה קפטן אחר, שחקן אחד
 * ששניהם פספסו, או מזל.
 *
 * זו בדיוק השאלה שמחזירה אנשים בשבוע הבא. עכשיו אפשר לענות
 * עליה בלחיצה על שורה.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ למה זה בטוח לפתוח את ההרכבים
 * ═══════════════════════════════════════════════════════════════
 *
 * ההסתרה יושבת **בשרת**: `game.entries` מחזירה `slots: []` ו-
 * `hidden: true` לכל הגשה שאינה שלי כל עוד `now() < lock_at`.
 * המסך הזה לא "מחליט להראות" — הוא מציג את מה שהשרת שלח, ולפני
 * הנעילה השרת לא שולח כלום. לכן אין כאן שום דלת חדשה: אחרי
 * הנעילה אי אפשר להעתיק כי אי אפשר להגיש.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ שלוש החלטות עיצוב
 * ═══════════════════════════════════════════════════════════════
 *
 *  1. **אותו מגרש.** לא רשימה. אותו `<Pitch>`, אותו כרטיס שחקן
 *     (`LockedSlotCard`), אותם צבעים. הרכב של יריב שנראה אחרת
 *     מההרכב שלי הוא הרכב שקשה להשוות אליו — וזה כל התכלית.
 *
 *  2. **ההשוואה היא ההפרש, לא הרשימה.** מה ששנינו בחרנו הוא
 *     רעש: הוא לא הסביר את הפער. מה שרק הוא בחר, ומה שרק אני
 *     בחרתי — זה הסיפור. לכן ההשוואה מדגישה **הבדלים** ומעמעמת
 *     משותפים.
 *
 *  3. **פעולה ראשית אחת:** לסגור. זה מסך צפייה, לא לוח בקרה.
 */
import { useMemo, useState } from 'react';

import { Pitch } from './Pitch.tsx';
import { LockedSlotCard } from './LockedLineup.tsx';
import type { PoolPlayer, TeamMeta } from './SquadPicker.tsx';
import { PRESS, NIGHT_PRESS as NP, MISREGISTER } from '../lib/pressPalette.ts';
import { modeTheme, type ModeId } from '../lib/modeTheme.ts';
import type { LineupEntry } from '../lib/store.ts';
import type { LineupScore } from '../lib/scoring/types.ts';

export interface RivalLineupProps {
  /** ההגשה שרוצים לראות. */
  entry: LineupEntry;
  /** הניקוד שלה — מאותו צינור שמזין את הטבלה (`buildLeaderboard`). */
  score?: LineupScore;
  rank?: number;
  /** האם המספרים עדיין זזים. */
  live?: boolean;
  /** ההגשה שלי באותו מצב משחק, אם יש — בשבילה קיים מצב ההשוואה. */
  mine?: LineupEntry;
  mineScore?: LineupScore;
  pool: PoolPlayer[];
  teams: TeamMeta[];
  mode: ModeId;
  onClose: () => void;
}

export function RivalLineup({
  entry, score, rank, live = false, mine, mineScore, pool, teams, mode, onClose,
}: RivalLineupProps) {
  const [compare, setCompare] = useState(false);

  const poolById = useMemo(() => new Map(pool.map((p) => [p.id, p])), [pool]);
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const theme = modeTheme(mode);

  const pointsByPlayer = useMemo(
    () => new Map((score?.players ?? []).map((p) => [p.playerId, p.subtotal])),
    [score],
  );

  /* ★ ההשוואה מחושבת פעם אחת, ומכאן מוזנים גם המגרש וגם הרשימה.
     שני חישובים היו יכולים לא להסכים — ואז המגרש מסמן שחקן
     כמשותף בזמן שהרשימה סופרת אותו כהפרש. */
  const diff = useMemo(() => {
    if (!mine) return null;
    const mineIds = new Set(mine.lineup.slots.map((s) => s.playerId).filter(Boolean));
    const theirIds = new Set(entry.lineup.slots.map((s) => s.playerId).filter(Boolean));

    const minePts = new Map((mineScore?.players ?? []).map((p) => [p.playerId, p.subtotal]));

    const onlyTheirs = [...theirIds].filter((id) => !mineIds.has(id));
    const onlyMine = [...mineIds].filter((id) => !theirIds.has(id));

    const sum = (ids: string[], m: Map<string, number>) =>
      ids.reduce((n, id) => n + (m.get(id) ?? 0), 0);

    return {
      shared: [...theirIds].filter((id) => mineIds.has(id)),
      onlyTheirs, onlyMine,
      theirsPoints: sum(onlyTheirs, pointsByPlayer),
      minePoints: sum(onlyMine, minePts),
      minePtsMap: minePts,
    };
  }, [mine, mineScore, entry, pointsByPlayer]);

  const gap = score && mineScore ? score.totalPoints - mineScore.totalPoints : null;

  const name = (id: string) => poolById.get(id)?.nameShort ?? id;
  const teamShort = (id: string) => {
    const p = poolById.get(id);
    return p ? (teamById.get(p.teamId)?.short ?? '') : '';
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`ההרכב של ${entry.teamName || entry.displayName}`}
      className="fixed inset-0 z-sheet flex flex-col"
      style={{ background: NP.paper }}
    >
      {/* ── כותרת מדור: קו כפול, שם, ניקוד ── */}
      <header className="shrink-0 px-4 pt-[calc(0.5rem+env(safe-area-inset-top))]">
        <div aria-hidden="true"
             style={{ borderTop: `3px solid ${NP.ruleStrong}`,
                      borderBottom: `1px solid ${NP.rule}`, height: 4 }} />

        <div className="flex items-start gap-3 py-2">
          <div className="min-w-0 flex-1">
            <h2 className="font-press truncate text-[22px] font-black leading-none"
                style={{ color: NP.ink, textShadow: MISREGISTER }}>
              {entry.teamName || entry.displayName}
            </h2>
            <p className="truncate pt-1 text-[11.5px]" style={{ color: NP.inkDim }}>
              {entry.teamName ? `${entry.displayName} · ` : ''}
              {theme.name}
              {rank ? ` · מקום ${rank}` : ''}
            </p>
          </div>

          {score && (
            <div className="shrink-0 text-center">
              <div dir="ltr" className="num text-[30px] font-black leading-none"
                   style={{ color: NP.goldLight }}>
                {score.totalPoints}
              </div>
              <div className="text-[10px] font-bold" style={{ color: NP.inkFaint }}>
                {live ? 'נק׳ · חי' : 'נק׳'}
              </div>
            </div>
          )}

          <button
            onClick={onClose}
            aria-label="סגירה"
            className="tap grid size-9 shrink-0 place-items-center rounded-full"
            style={{ border: `1px solid ${NP.rule}`, color: NP.ink }}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
              <path d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5"
                    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div aria-hidden="true" style={{ borderTop: `1px solid ${NP.rule}` }} />

        {/* ── מתג ההשוואה. מוצג רק כשיש למה להשוות. ── */}
        {diff && (
          <div className="flex items-center gap-2 py-2">
            <button
              onClick={() => setCompare((v) => !v)}
              aria-pressed={compare}
              className="font-press tap px-3 py-1.5 text-[13px] font-black
                         transition-colors duration-200 ease-brand"
              style={compare
                ? { background: theme.accent, color: NP.paper }
                : { border: `1px solid ${NP.rule}`, color: NP.inkFaint }}
            >
              השוואה להרכב שלי
            </button>

            {gap !== null && (
              <span className="text-[12px] font-bold"
                    style={{ color: gap > 0 ? NP.redLight : gap < 0 ? '#7FBF6A' : NP.inkFaint }}
                    dir="rtl">
                {gap === 0 ? 'תיקו' : gap > 0
                  ? <>מקדים אותך ב־<span className="num" dir="ltr">{gap}</span></>
                  : <>אתה מקדים ב־<span className="num" dir="ltr">{Math.abs(gap)}</span></>}
              </span>
            )}
          </div>
        )}
      </header>

      {/* ── המגרש ── */}
      <div className="grid min-h-0 flex-1 place-items-center px-2 py-1">
        <Pitch
          formation={entry.lineup.formation}
          fit="height"
          accent={theme.accent}
          frameColor={PRESS.paper}
          renderSlot={(slotNo) => {
            const slot = entry.lineup.slots.find((x) => x.slotNo === slotNo);
            if (!slot?.playerId) return null;

            /* ★ בהשוואה: משותף מתעמעם, שונה נשאר מלא ומקבל טבעת.
               ההפרש הוא הסיפור, ולכן הוא זה שקורא. */
            const shared = compare && diff?.shared.includes(slot.playerId);
            const differs = compare && diff?.onlyTheirs.includes(slot.playerId);

            return (
              <div
                className="transition-opacity duration-200 ease-brand"
                style={{
                  opacity: shared ? 0.42 : 1,
                  filter: differs ? `drop-shadow(0 0 6px ${theme.accent})` : undefined,
                }}
              >
                <LockedSlotCard
                  slot={slot}
                  player={poolById.get(slot.playerId)}
                  team={teamById.get(slot.teamId)}
                  points={pointsByPlayer.get(slot.playerId)}
                  live={live}
                />
              </div>
            );
          }}
        />
      </div>

      {/* ── ההפרש, במילים ── */}
      {compare && diff && (
        <div className="max-h-[38vh] shrink-0 overflow-y-auto overscroll-contain px-4 pb-1">
          <DiffColumn
            title="רק אצלו"
            accent={theme.accent}
            total={diff.theirsPoints}
            rows={diff.onlyTheirs.map((id) => ({
              id, name: name(id), team: teamShort(id), points: pointsByPlayer.get(id) ?? 0,
            }))}
          />
          <DiffColumn
            title="רק אצלך"
            accent={NP.gold}
            total={diff.minePoints}
            rows={diff.onlyMine.map((id) => ({
              id, name: name(id), team: teamShort(id), points: diff.minePtsMap.get(id) ?? 0,
            }))}
          />
          {diff.onlyTheirs.length === 0 && diff.onlyMine.length === 0 && (
            <p className="py-3 text-center text-[12px]" style={{ color: NP.inkDim }}>
              אותו הרכב בדיוק. ההפרש כולו בקפטן.
            </p>
          )}
        </div>
      )}

      {/* ── פעולה ראשית אחת ── */}
      <div className="shrink-0 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2"
           style={{ borderTop: `1px solid ${NP.rule}` }}>
        <button
          onClick={onClose}
          className="tap font-press h-12 w-full text-[15px] font-black
                     transition-transform duration-200 ease-brand active:scale-[.99]"
          style={{ background: NP.gold, color: NP.paper }}
        >
          חזרה לדירוג
        </button>
      </div>
    </div>
  );
}

/* ================================================================== */

function DiffColumn({
  title, accent, rows, total,
}: {
  title: string;
  accent: string;
  total: number;
  rows: Array<{ id: string; name: string; team: string; points: number }>;
}) {
  if (rows.length === 0) return null;

  return (
    <div className="pt-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-black tracking-[2px]" style={{ color: accent }}>
          {title}
        </span>
        <span className="num text-[12px] font-black" dir="ltr" style={{ color: accent }}>
          {total}
        </span>
      </div>
      <ul className="pt-1">
        {rows.map((r) => (
          <li key={r.id}
              className="flex items-center gap-2 py-1"
              style={{ borderBottom: `1px solid ${NP.rule}` }}>
            <span className="min-w-0 flex-1 truncate text-[13px] font-bold"
                  style={{ color: NP.ink }}>
              <bdi>{r.name}</bdi>
              <span className="ms-1.5 text-[11px] font-normal" style={{ color: NP.inkFaint }}>
                {r.team}
              </span>
            </span>
            <span className="num shrink-0 text-[13px] font-black" dir="ltr"
                  style={{ color: r.points > 0 ? NP.ink : NP.inkFaint }}>
              {r.points}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
