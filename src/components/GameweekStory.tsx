/**
 * components/GameweekStory.tsx — מסך התוצאה.
 *
 * זה המסך שמחזיר משתמשים. הוא בנוי כמו כותרת בעיתון ספורט של
 * פעם: מספר ענק, שורת דרמה אחת, ואז הפרטים הקטנים.
 *
 * פעולה ראשית אחת בלבד בתחתית — "המחזור הבא". הברִיף מפורש:
 * "לכל מסך חשוב פעולה ראשית אחת ברורה".
 */
import type { GameweekStory as Story, StoryPick } from '../lib/story.ts';
import { TEAM_BY_ID } from '../data/squads.ts';
import { Jersey } from './Jersey.tsx';

export function GameweekStory({
  story, label, playerName, onNext,
}: {
  story: Story;
  /** "מחזור 7" */
  label: string;
  playerName: (playerId: string) => string;
  onNext?: () => void;
}) {
  const up = (story.rankDelta ?? 0) > 0;

  return (
    <div className="mx-auto max-w-lg px-4 py-6 lg:max-w-2xl">
      {/* ---------- הכותרת ---------- */}
      <div className="relative overflow-hidden rounded-3xl border border-gold/15 bg-night-2">
        {/* דשא: רמז, לא איור. */}
        <div className="tex-turf absolute inset-x-0 top-0 h-1.5 opacity-70" aria-hidden="true" />

        <div className="px-5 pb-5 pt-6 text-center">
          <div className="text-[11px] font-black uppercase tracking-[0.2em] text-chalk-dim">
            {label}
          </div>

          <div className="num mt-1 text-7xl font-black leading-none text-gold" dir="ltr">
            {story.totalPoints}
          </div>
          <div className="mt-0.5 text-xs font-bold text-chalk-dim">נקודות</div>

          {/* תנועת דירוג — הדרמה */}
          {story.rankDelta !== null && story.rankDelta !== 0 && (
            <div
              className={[
                'mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1',
                'text-sm font-black',
                up ? 'bg-pitch-2 text-chalk' : 'bg-flare/15 text-flare',
              ].join(' ')}
            >
              <span aria-hidden="true">{up ? '↑' : '↓'}</span>
              <span className="num" dir="ltr">{Math.abs(story.rankDelta)}</span>
              <span>{up ? 'מקומות למעלה' : 'מקומות למטה'}</span>
            </div>
          )}
          {story.rankDelta === null && (
            <div className="mt-3 inline-block rounded-full bg-night-3 px-3 py-1
                            text-sm font-black text-chalk-dim">
              המחזור הראשון שלך
            </div>
          )}
        </div>

        {/* ---------- דירוג ואחוזון ---------- */}
        <div className="grid grid-cols-2 divide-x divide-x-reverse divide-gold/15
                        border-t border-gold/15">
          <Stat label="המקום שלך" value={`#${story.rank}`} sub={`מתוך ${story.entrants}`} />
          <Stat
            label="ניצחת"
            value={`${story.beatPct}%`}
            sub="מהשחקנים"
            accent={story.beatPct >= 50}
          />
        </div>
      </div>

      {/* ---------- הבחירות ---------- */}
      <div className="mt-4 space-y-2">
        {story.captain && (
          <PickRow
            title={story.captainTransferred ? 'הסרט עבר לסגן' : 'הקפטן שלך'}
            pick={story.captain}
            playerName={playerName}
            tone={story.captain.points >= 10 ? 'good' : story.captain.points <= 2 ? 'bad' : 'flat'}
          />
        )}
        {story.bestPick && (
          <PickRow title="הבחירה הכי טובה" pick={story.bestPick} playerName={playerName} tone="good" />
        )}
        {story.worstPick && (
          <PickRow title="הבחירה שכאבה" pick={story.worstPick} playerName={playerName} tone="bad" />
        )}
        {story.differentialPoints > 0 && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border
                          border-tekhelet/30 bg-tekhelet/10 px-4 py-3">
            <div>
              <div className="text-[11px] font-black uppercase tracking-wide text-tekhelet">
                בחירה נדירה
              </div>
              <div className="text-sm text-chalk">מצאת שחקן שרוב הליגה פספסה</div>
            </div>
            <div className="num text-xl font-black text-tekhelet" dir="ltr">
              +{story.differentialPoints}
            </div>
          </div>
        )}
      </div>

      {/* ---------- פעולה ראשית אחת ---------- */}
      {onNext && (
        <button
          type="button"
          onClick={onNext}
          className="tap mt-5 w-full rounded-2xl bg-gold py-4 font-display text-base
                     font-black text-night transition-transform duration-200
                     ease-brand active:scale-[0.98]"
        >
          המחזור הבא ←
        </button>
      )}
    </div>
  );
}

function Stat({
  label, value, sub, accent = false,
}: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="px-4 py-3.5 text-center">
      <div className="text-[10px] font-black uppercase tracking-wide text-chalk-dim">{label}</div>
      <div className={`num mt-0.5 text-2xl font-black ${accent ? 'text-pitch-2' : 'text-chalk'}`} dir="ltr">
        {value}
      </div>
      {sub ? <div className="text-[11px] text-chalk-dim">{sub}</div> : null}
    </div>
  );
}

function PickRow({
  title, pick, playerName, tone,
}: {
  title: string;
  pick: StoryPick;
  playerName: (id: string) => string;
  tone: 'good' | 'bad' | 'flat';
}) {
  const team = TEAM_BY_ID.get(pick.teamId);
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-gold/15 bg-night-2 px-4 py-3">
      <Jersey teamId={pick.teamId} size={38} captain={pick.isCaptain} />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-black uppercase tracking-wide text-chalk-dim">{title}</div>
        <div className="truncate text-sm font-bold text-chalk">
          {playerName(pick.playerId)}
          <span className="ms-1.5 text-[11px] font-normal text-chalk-dim">{team?.short ?? ''}</span>
        </div>
      </div>
      <div
        className={[
          'num shrink-0 text-xl font-black',
          tone === 'good' ? 'text-pitch-2' : tone === 'bad' ? 'text-flare' : 'text-chalk-dim',
        ].join(' ')}
        dir="ltr"
      >
        {pick.points > 0 ? '+' : ''}{pick.points}
      </div>
    </div>
  );
}
