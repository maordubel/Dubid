/**
 * Leaderboard.tsx — דירוג חכמים.
 *
 * מה השתנה מהגרסה הקודמת, ולמה:
 *
 *  1. **דירוג דטרמיניסטי.** קודם המיון היה לפי ניקוד בלבד, ושני
 *     משתמשים עם אותו ציון קיבלו סדר שתלוי בסדר ההגשה במערך.
 *     עכשיו רצה היררכיית שוברי השוויון המלאה (`rankEntries`), והמסך
 *     גם *אומר* מה שבר את השוויון. הברִיף אוסר הכרעה אקראית.
 *
 *  2. **בונוס דיפרנציאל.** מחושב כאן ולא במנוע, כי הוא תלוי בכל
 *     ההגשות יחד ולא בהרכב בודד.
 *
 *  3. **המשתמש תמיד רואה את עצמו.** גם במקום 127 מתוך 400. זו
 *     דרישה מפורשת בברִיף, והיא ההבדל בין "לוח תוצאות" לבין
 *     "התחרות שלי".
 *
 *  4. **טבלה במקום רשימה.** אותו קומפוננט נותן כרטיסים במובייל
 *     וטבלה בדסקטופ (`Table.tsx`).
 *
 * שני מצבי המשחק חולקים תשתית אחת לגמרי — כל אחד רק עם ה-RuleSet
 * שלו, ולכן שני לוחות דירוג נפרדים. הברִיף אוסר למזג אותם.
 */
import { useMemo, useState, useEffect } from 'react';

import { scoreLineup } from '../lib/scoring/engine.ts';
import { applyDifferential, rankEntries, selectionRates, type TieBreakStage }
  from '../lib/scoring/ranking.ts';
import { TEAM_BY_ID } from '../data/squads.ts';
import { GAMEWEEK } from '../data/fixtures.ts';
import { listEntries, getResults, subscribeToStore, type LineupEntry } from '../lib/store.ts';
import type { LineupScore } from '../lib/scoring/types.ts';
import type { RuleSet } from '../lib/scoring/rules.ts';
import { Table, type Column } from './Table.tsx';

const MODE_LABEL: Record<'full' | 'five', string> = { full: 'דוביד 11', five: 'דוביד 5' };

/** מה שבר את השוויון — בשפה שמסבירה, לא בקוד. */
const TIEBREAK_LABEL: Record<TieBreakStage, string> = {
  total:        '',
  captain:      'הוכרע לפי הקפטן',
  differential: 'הוכרע לפי בחירות נדירות',
  goals:        'הוכרע לפי שערים',
  assists:      'הוכרע לפי בישולים',
  clean_sheets: 'הוכרע לפי שערים נקיים',
  other:        'הוכרע לפי תרומה נוספת',
  submitted_at: 'הוכרע לפי זמן ההגשה',
};

interface Row {
  rank: number;
  tied: boolean;
  brokenBy: TieBreakStage | null;
  entry: LineupEntry;
  score: LineupScore;
  isMe: boolean;
}

export function Leaderboard({
  rulesByMode, userId,
}: {
  rulesByMode: Record<'full' | 'five', RuleSet>;
  /** מי אני — כדי להדגיש ולעגן את השורה שלי. */
  userId?: string;
}) {
  const [, tick] = useState(0);
  useEffect(() => subscribeToStore(() => tick((n) => n + 1)), []);
  const [mode, setMode] = useState<'full' | 'five'>('five');

  const entries = listEntries(GAMEWEEK.id, mode);
  const results = getResults(GAMEWEEK.id);
  const rules = rulesByMode[mode];

  const rows = useMemo<Row[]>(() => {
    if (!results.published) return [];

    // 1. ניקוד בסיס לכל הגשה
    const scored: Array<{ entry: LineupEntry; score: LineupScore }> = [];
    for (const entry of entries) {
      try {
        scored.push({
          entry,
          score: scoreLineup(entry.lineup, results.performances, results.outcomes, rules, {
            validate: false,
          }),
        });
      } catch {
        /* הרכב שנשמר תחת חוקים ישנים — לא נכנס לדירוג, ולא מפיל את המסך */
      }
    }

    // 2. דיפרנציאל — דורש את כל ההגשות יחד
    const rates = selectionRates(
      scored.map((s) => ({ playerIds: s.entry.lineup.slots.map((x) => x.playerId) })),
    );
    const withDiff = scored.map((s) => ({
      ...s,
      score: applyDifferential(s.score, rates, scored.length),
    }));

    // 3. דירוג עם שוברי שוויון
    return rankEntries(
      withDiff.map((s) => ({ entry: s, score: s.score, submittedAt: s.entry.submittedAt })),
    ).map((r) => ({
      rank: r.rank,
      tied: r.tied,
      brokenBy: r.brokenBy,
      entry: r.entry.entry,
      score: r.entry.score,
      isMe: !!userId && r.entry.entry.userId === userId,
    }));
  }, [entries, results, rules, userId]);

  const me = rows.find((r) => r.isMe);
  // ★ אם אני מחוץ ל-20 הראשונים, אני עדיין רואה את עצמי — מעוגן בנפרד.
  const top = rows.slice(0, 20);
  const meOutsideTop = me && !top.some((r) => r.isMe) ? me : null;

  const columns: Column<Row>[] = [
    {
      key: 'rank',
      header: '#',
      width: '3.5rem',
      primary: true,
      render: (r) => <RankBadge rank={r.rank} tied={r.tied} />,
    },
    {
      key: 'name',
      header: 'שחקן',
      primary: true,
      render: (r) => (
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-chalk">
            {r.entry.displayName}
            {r.isMe && (
              <span className="ms-1.5 rounded bg-toto px-1.5 py-px text-[10px] font-black text-night">
                אני
              </span>
            )}
          </div>
          <div className="truncate text-[11px] text-chalk-dim">
            {captainLabel(r.score)}
            {r.tied && r.brokenBy && r.brokenBy !== 'total'
              ? ` · ${TIEBREAK_LABEL[r.brokenBy]}`
              : ''}
          </div>
        </div>
      ),
    },
    {
      key: 'captain',
      header: 'קפטן',
      primary: false,
      numeric: true,
      width: '4.5rem',
      render: (r) => <span className="text-chalk-dim">{r.score.captainPoints}</span>,
    },
    {
      key: 'diff',
      header: 'נדיר',
      primary: false,
      numeric: true,
      width: '4.5rem',
      render: (r) =>
        (r.score.differentialPoints ?? 0) > 0 ? (
          <span className="text-tekhelet">+{r.score.differentialPoints}</span>
        ) : (
          <span className="text-chalk-dim">—</span>
        ),
    },
    {
      key: 'total',
      header: 'נק׳',
      primary: true,
      numeric: true,
      width: '4.5rem',
      render: (r) => (
        <span className="text-lg font-black text-toto">{r.score.totalPoints}</span>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-5">
      <header className="mb-4">
        <h2 className="font-display text-xl font-black">דירוג חכמים</h2>
        <p className="text-xs text-chalk-dim">
          {GAMEWEEK.label} · {entries.length} הרכבים הוגשו
        </p>
      </header>

      <div className="mb-4 flex gap-1.5 rounded-full bg-night-2 p-1">
        {(['five', 'full'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`tap flex-1 rounded-full py-2 text-sm font-black transition-colors
                        duration-200 ease-brand ${
                          mode === m ? 'bg-toto text-night' : 'text-chalk-dim'
                        }`}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      {!results.published ? (
        <div className="rounded-2xl border border-chalk/10 bg-night-2 px-4 py-8 text-center">
          <div className="mx-auto mb-3 h-1 w-12 rounded-full bg-toto" />
          <p className="font-bold text-chalk">הדירוג ייפתח כשהמחזור יסתיים</p>
          <p className="mt-1 text-sm text-chalk-dim">
            ברגע שהמחזור מפורסם, כל ההרכבים מדורגים כאן אוטומטית.
          </p>
        </div>
      ) : (
        <>
          {/* ★ הכרטיס שלי — לפני הטבלה, תמיד נראה */}
          {me && (
            <div className="mb-3 flex items-center gap-3 rounded-2xl border border-toto/40
                            bg-toto/10 px-4 py-3">
              <RankBadge rank={me.rank} tied={me.tied} />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-black uppercase tracking-wide text-toto">
                  התוצאה שלך
                </div>
                <div className="truncate text-sm font-bold text-chalk">
                  ניצחת {beatPct(me.rank, rows.length)}% מהשחקנים
                </div>
              </div>
              <div className="num text-2xl font-black text-toto" dir="ltr">
                {me.score.totalPoints}
              </div>
            </div>
          )}

          <Table
            columns={columns}
            rows={top}
            rowKey={(r) => r.entry.id}
            highlight={(r) => r.isMe}
            caption={`${MODE_LABEL[mode]} · ${rows.length} משתתפים`}
            empty={`עדיין אין הרכבים מוגשים ב"${MODE_LABEL[mode]}".`}
          />

          {meOutsideTop && (
            <>
              <div className="py-2 text-center text-chalk-dim" aria-hidden="true">⋯</div>
              <Table
                columns={columns}
                rows={[meOutsideTop]}
                rowKey={(r) => r.entry.id}
                highlight={() => true}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

function RankBadge({ rank, tied }: { rank: number; tied: boolean }) {
  return (
    <div
      title={tied ? 'שוויון' : undefined}
      className={`num flex h-8 w-8 shrink-0 items-center justify-center rounded-full
                  text-sm font-black ${
                    rank === 1
                      ? 'bg-armband text-night'
                      : rank <= 3
                        ? 'bg-toto text-night'
                        : 'bg-chalk/10 text-chalk-dim'
                  }`}
    >
      {rank}
      {tied && <span className="ms-px text-[9px]">=</span>}
    </div>
  );
}

function captainLabel(score: LineupScore): string {
  const c = score.players.find((p) => p.isCaptain);
  return c ? `קפטן: ${TEAM_BY_ID.get(c.teamId)?.short ?? ''} · ${c.subtotal}` : '';
}

function beatPct(rank: number, total: number): number {
  return total > 1 ? Math.round(((total - rank) / (total - 1)) * 100) : 100;
}
