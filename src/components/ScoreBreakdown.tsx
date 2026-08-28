/**
 * components/ScoreBreakdown.tsx — למה קיבלת את הניקוד הזה.
 *
 * ★ הכלל מהברִיף: "לעולם לא להציג רק ציון סופי".
 *
 * מספר בלי הסבר מייצר תסכול, לא תחרות. משתמש שרואה 64 ולא יודע
 * מאיפה — לא ילמד, לא ישתפר, ולא יחזור. משתמש שרואה שהקפטן שלו
 * נתן 18 מתוך ה-64 חוזר בשבוע הבא עם דעה.
 *
 * שתי רמות, בכוונה:
 *   1. סיכום לפי קטגוריה — מה שרואים מיד.
 *   2. פירוט לפי שחקן — נפתח בלחיצה, לא מוצג ביחד.
 * הברִיף אוסר "כרטיסים עמוסים". פירוט מלא זה עומס אלא אם ביקשו אותו.
 */
import { useState } from 'react';
import { GROUP_ORDER, GROUP_LABELS, labelFor, lineText, type ReasonGroup }
  from '../lib/scoring/labels.ts';
import type { LineupScore, ScoreLine } from '../lib/scoring/types.ts';
import { TEAM_BY_ID } from '../data/squads.ts';
import { TeamTag } from './TeamTag.tsx';

/** מספר מנוקד עם סימן — ‎+12‎ / ‎-2‎. אף פעם לא "12-" ב-RTL. */
export function Signed({ value, muted = false }: { value: number; muted?: boolean }) {
  const positive = value > 0;
  return (
    <span
      dir="ltr"
      className={[
        'num tabular-nums',
        muted ? 'text-chalk-dim' : positive ? 'text-chalk' : value < 0 ? 'text-flare' : 'text-chalk-dim',
      ].join(' ')}
    >
      {positive ? '+' : ''}{value}
    </span>
  );
}

export function ScoreBreakdown({
  score, playerName,
}: {
  score: LineupScore;
  /** שם לתצוגה לכל שחקן. חסר = מזהה. */
  playerName?: (playerId: string) => string;
}) {
  const [open, setOpen] = useState(false);

  const allLines: ScoreLine[] = [
    ...score.players.flatMap((p) => p.lines),
    ...score.bonusLines,
  ];

  // סכימה לפי קטגוריה, בסדר קבוע.
  const byGroup = new Map<ReasonGroup, number>();
  for (const l of allLines) {
    const g = labelFor(l.reason).group;
    byGroup.set(g, (byGroup.get(g) ?? 0) + l.points);
  }
  const groups = GROUP_ORDER
    .map((g) => ({ group: g, points: round2(byGroup.get(g) ?? 0) }))
    .filter((g) => g.points !== 0);

  return (
    <section className="overflow-hidden rounded-2xl border border-gold/15 bg-night-2">
      {/* ---- הכותרת: הציון, גדול ---- */}
      <header className="flex items-baseline justify-between gap-3 border-b border-gold/15
                         bg-night-3/50 px-4 py-3">
        <h3 className="font-press text-sm font-black text-chalk-dim">פירוט הניקוד</h3>
        <div className="num text-3xl font-black leading-none text-gold" dir="ltr">
          {score.totalPoints}
        </div>
      </header>

      {/* ---- סיכום לפי קטגוריה ---- */}
      <dl className="divide-y divide-gold/10">
        {groups.map(({ group, points }) => (
          <div key={group} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <dt className="text-sm text-chalk">{GROUP_LABELS[group]}</dt>
            <dd className="text-base font-black"><Signed value={points} /></dd>
          </div>
        ))}
      </dl>

      {/* ---- הסך הכול ---- */}
      <div className="flex items-center justify-between gap-3 border-t border-gold/15
                      bg-night-3/40 px-4 py-3">
        <span className="font-display text-sm font-black">סך הכול</span>
        <span className="num text-xl font-black text-gold" dir="ltr">{score.totalPoints}</span>
      </div>

      {/* ---- פירוט לפי שחקן, מקופל ---- */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="tap flex w-full items-center justify-center gap-1.5 border-t border-gold/15
                   py-3 text-xs font-black text-chalk-dim transition-colors
                   duration-200 ease-brand hover:text-chalk"
      >
        {open ? 'סגירת הפירוט' : 'פירוט לפי שחקן'}
        <span aria-hidden="true" className={open ? 'rotate-180' : ''}>⌄</span>
      </button>

      {open && (
        <ul className="divide-y divide-gold/10 border-t border-gold/15">
          {[...score.players]
            .sort((a, b) => b.subtotal - a.subtotal)
            .map((p) => (
              <li key={p.playerId} className="px-4 py-3">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    {p.isCaptain && (
                      <span className="shrink-0 rounded bg-armband px-1
                                       text-[10px] font-black leading-[16px] text-night">C</span>
                    )}
                    <bdi className="min-w-0 truncate text-sm font-bold text-chalk">
                      {playerName?.(p.playerId) ?? p.playerId}
                    </bdi>
                    {/* ★ תג בצבע המועדון במקום טקסט אפור.
                        בפירוט של אחת־עשרה שורות, הצבע הוא מה
                        שמאפשר לסרוק ולמצוא שחקן בלי לקרוא. */}
                    <TeamTag
                      teamId={p.teamId}
                      short={TEAM_BY_ID.get(p.teamId)?.short}
                      name={TEAM_BY_ID.get(p.teamId)?.nameHe}
                      size="xs"
                    />
                  </span>
                  <span className="num shrink-0 text-sm font-black text-chalk" dir="ltr">
                    {p.subtotal}
                  </span>
                </div>
                <ul className="space-y-0.5">
                  {p.lines.map((l, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-2 text-[11px]">
                      <span className="text-chalk-dim">
                        {lineText(l.reason, l.count)}
                        {l.reason === 'differential' && l.meta
                          ? ` · רק ${(l.meta as { selectionPct: number }).selectionPct}% בחרו בו`
                          : ''}
                      </span>
                      <Signed value={l.points} muted />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          {score.bonusLines.length > 0 && (
            <li className="px-4 py-3">
              <div className="mb-1.5 text-sm font-bold text-chalk">בונוס הרכב</div>
              <ul className="space-y-0.5">
                {score.bonusLines.map((l, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-2 text-[11px]">
                    <span className="text-chalk-dim">{lineText(l.reason, l.count)}</span>
                    <Signed value={l.points} muted />
                  </li>
                ))}
              </ul>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;
