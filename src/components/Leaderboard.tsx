/**
 * Leaderboard.tsx — דירוג חכמים.
 *
 * קורא את ההרכבים שהוגשו (store.listEntries) ואת תוצאות המחזור שהאדמין
 * הזין (store.getResults), ומריץ עליהם את אותו `scoreLineup` בדיוק שה-
 * Edge Function הרשמי ירוץ עליו בעתיד. כל עוד התוצאות לא פורסמו, מוצג
 * מסך המתנה — כדי שאף אחד לא יראה דירוג חלקי/שגוי לפני שהאדמין סיים.
 */
import { useMemo, useState, useEffect } from 'react';

import { scoreLineup, rankGameweek } from '../lib/scoring/engine.ts';
import { TEAM_BY_ID } from '../data/squads.ts';
import { GAMEWEEK } from '../data/fixtures.ts';
import { listEntries, getResults, subscribeToStore, type LineupEntry } from '../lib/store.ts';
import type { LineupScore } from '../lib/scoring/types.ts';
import type { RuleSet } from '../lib/scoring/rules.ts';

export function Leaderboard({ rules }: { rules: RuleSet }) {
  const [, tick] = useState(0);
  useEffect(() => subscribeToStore(() => tick((n) => n + 1)), []);

  const entries = listEntries(GAMEWEEK.id);
  const results = getResults(GAMEWEEK.id);

  const ranked = useMemo(() => {
    if (!results.published) return [];
    const withScores: Array<{ entry: LineupEntry; score: LineupScore }> = [];
    for (const entry of entries) {
      try {
        const score = scoreLineup(entry.lineup, results.performances, results.outcomes, rules, { validate: false });
        withScores.push({ entry, score });
      } catch {
        /* הרכב לא תקין (למשל נשמר תחת חוקים ישנים) — לא נכנס לדירוג */
      }
    }
    const entryByScore = new Map(withScores.map((w) => [w.score, w.entry]));
    return rankGameweek(withScores.map((w) => w.score)).map((r) => ({
      ...r,
      entry: entryByScore.get(r.score)!,
    }));
  }, [entries, results, rules]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-display text-xl font-black">דירוג חכמים</h2>
          <p className="text-xs text-chalk-dim">{GAMEWEEK.label} · {entries.length} הרכבים הוגשו</p>
        </div>
      </div>

      {!results.published ? (
        <div className="rounded-2xl border border-chalk/10 bg-night-2 px-4 py-8 text-center">
          <div className="mx-auto mb-3 h-1 w-12 rounded-full bg-toto" />
          <p className="font-bold text-chalk">הדירוג ייפתח כשהמחזור יסתיים</p>
          <p className="mt-1 text-sm text-chalk-dim">
            האדמין מזין תוצאות בלוח הניהול. ברגע שהמחזור מפורסם, כל ההרכבים מדורגים כאן אוטומטית.
          </p>
        </div>
      ) : ranked.length === 0 ? (
        <div className="rounded-2xl border border-chalk/10 bg-night-2 px-4 py-8 text-center text-sm text-chalk-dim">
          עדיין אין הרכבים מוגשים למחזור הזה.
        </div>
      ) : (
        <ol className="space-y-2">
          {ranked.map(({ rank, entry, score }) => (
            <li
              key={entry.id}
              className="flex items-center gap-3 rounded-xl border border-chalk/10 bg-night-2 px-4 py-3"
            >
              <div className={`num flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black ${
                rank === 1 ? 'bg-armband text-night' : rank <= 3 ? 'bg-toto text-night' : 'bg-chalk/10 text-chalk-dim'
              }`}>
                {rank}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-bold text-chalk">{entry.displayName}</div>
                <div className="truncate text-[11px] text-chalk-dim">
                  {score.players
                    .filter((p) => p.isCaptain)
                    .map((p) => `קפטן: ${TEAM_BY_ID.get(p.teamId)?.short ?? ''}`)
                    .join(' · ')}
                </div>
              </div>
              <div className="num text-lg font-black text-toto">{score.totalPoints}</div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
