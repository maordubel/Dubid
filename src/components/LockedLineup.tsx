/**
 * components/LockedLineup.tsx — "ננעל". שכבה שלישית במכונת המצבים:
 * DRAFT → SUBMIT → LOCKED LINEUP → SCORING.
 *
 * ברגע שיש הגשה (`LineupEntry`), זו התצוגה — לא ה-SquadPicker. אין
 * כאן כפתורי הוספה/הסרה/קפטן: זה תיעוד של מה שהוגש, לא עריכה חיה.
 * היחיד שמותר עד לפרסום התוצאות הוא "ביטול הגשה" מפורש (`onUnlock`),
 * שמחזיר את המשתמש לטיוטה — לא עריכה בשקט מתחת לרדאר.
 */
import { Jersey, jerseyMonogram } from './Jersey.tsx';
import type { PoolPlayer, TeamMeta } from './SquadPicker.tsx';
import type { Lineup, LineupScore, Position } from '../lib/scoring/types.ts';

const POSITION_LABEL: Record<Position, string> = {
  GK: 'שוער', DEF: 'הגנה', MID: 'קישור', FWD: 'התקפה',
};

export function LockedLineup({
  lineup, pool, teams, score, gameweekLabel, submittedAt, onUnlock, onViewCard,
}: {
  lineup: Lineup;
  pool: PoolPlayer[];
  teams: TeamMeta[];
  /** מוגדר רק אחרי שהאדמין פרסם תוצאות למחזור. */
  score?: LineupScore;
  gameweekLabel: string;
  submittedAt: string;
  /** מוצג רק כשמותר לבטל הגשה — כלומר לפני שהתוצאות פורסמו. */
  onUnlock?: () => void;
  onViewCard?: () => void;
}) {
  const poolById = new Map(pool.map((p) => [p.id, p]));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const pointsByPlayer = new Map((score?.players ?? []).map((p) => [p.playerId, p.subtotal]));
  const rows: Position[] = ['GK', 'DEF', 'MID', 'FWD'];

  const submittedLabel = new Date(submittedAt).toLocaleString('he-IL', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className="flex h-full flex-col">
      <div className="mx-3 mt-3 flex items-center justify-between rounded-2xl border border-gold/30
                       bg-gold/10 px-4 py-3">
        <div>
          <div className="flex items-center gap-1.5 text-sm font-black text-gold">
            <span aria-hidden>🔒</span> ההרכב הוגש ונעול
          </div>
          <div className="mt-0.5 text-[11px] text-chalk-dim">
            {gameweekLabel} · הוגש ב-<span className="num">{submittedLabel}</span>
          </div>
        </div>
        {score && (
          <div className="text-end">
            <div className="num text-2xl font-black text-gold">{score.totalPoints}</div>
            <div className="text-[10px] text-chalk-dim">נקודות</div>
          </div>
        )}
      </div>

      <div className="flex-1 px-3 pb-4">
        <div className="mx-auto mt-3 w-full max-w-3xl rounded-3xl p-3 tex-turf
                        ring-1 ring-inset ring-chalk/15">
          {rows.map((row) => {
            const slots = lineup.slots.filter((s) => s.position === row && !s.isBench && s.playerId);
            if (!slots.length) return null;
            return (
              <section key={row} aria-label={POSITION_LABEL[row]} className="mb-4 last:mb-1">
                <h2 className="mb-1.5 ps-1 text-[10px] font-bold tracking-[0.2em] text-chalk/70">
                  {POSITION_LABEL[row]}
                </h2>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(84px,1fr))] gap-2.5">
                  {slots.map((slot) => {
                    const player = poolById.get(slot.playerId);
                    const team = teamById.get(slot.teamId);
                    const points = pointsByPlayer.get(slot.playerId);
                    if (!player) return null;
                    return (
                      <div key={slot.slotNo} className="relative flex flex-col items-center gap-1">
                        {slot.isCaptain && (
                          <span className="absolute -top-1 start-1 z-10 grid size-6 place-items-center
                                            rounded-full bg-armband text-[10px] font-black text-night shadow-md">
                            C
                          </span>
                        )}
                        <Jersey teamId={team?.id} position={slot.position} monogram={jerseyMonogram(team?.short)} size={56} />
                        {slot.isCaptain && (
                          <span className="rounded-md bg-armband px-1.5 py-0.5 font-poster text-[10px] text-night">
                            קפטן ×3
                          </span>
                        )}
                        <div className="w-full max-w-[92px] rounded-lg bg-chalk px-1.5 py-1 text-center shadow-sm">
                          <bdi className="line-clamp-1 text-[11px] font-black leading-tight text-night">
                            {player.nameShort}
                          </bdi>
                        </div>
                        <div className={[
                          'w-full max-w-[92px] rounded-lg px-1.5 py-0.5 text-center text-[10px] font-bold',
                          points !== undefined ? 'bg-gold/15 text-gold' : 'bg-night-3 text-chalk-dim',
                        ].join(' ')}>
                          {points !== undefined ? <span className="num" dir="ltr">{points} נק'</span> : team?.short}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      <div className="sticky bottom-0 border-t border-gold/15 bg-night/95 px-4
                      pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        {score && onViewCard ? (
          <button
            onClick={onViewCard}
            className="tap h-14 w-full rounded-full bg-gold font-poster text-xl text-night
                       transition-transform duration-200 ease-brand active:scale-[.98]"
          >
            לצפייה בכרטיס המלא
          </button>
        ) : onUnlock ? (
          <button
            onClick={onUnlock}
            className="tap h-12 w-full rounded-full border border-flare/40 text-sm font-bold text-flare
                       transition-colors duration-200 ease-brand active:bg-flare/10"
          >
            ביטול הגשה ועריכה מחדש
          </button>
        ) : (
          <p className="text-center text-xs text-chalk-dim">
            הניקוד יופיע כאן ברגע שהמחזור יסתיים ויפורסם.
          </p>
        )}
      </div>
    </div>
  );
}
