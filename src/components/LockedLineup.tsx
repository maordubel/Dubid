/**
 * components/LockedLineup.tsx — "ננעל". שכבה שלישית במכונת המצבים:
 * DRAFT → SUBMIT → LOCKED LINEUP → SCORING.
 *
 * ברגע שיש הגשה (`LineupEntry`), זו התצוגה — לא ה-SquadPicker. אין
 * כאן כפתורי הוספה/הסרה/קפטן: זה תיעוד של מה שהוגש, לא עריכה חיה.
 * היחיד שמותר עד לפרסום התוצאות הוא "ביטול הגשה" מפורש (`onUnlock`).
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ למה המסך הזה נבנה מחדש
 * ═══════════════════════════════════════════════════════════════
 *
 * הוא היה המסך היחיד במוצר שלא ציית לשפה שלו.
 *
 * מסך הבחירה מצייר **מגרש** — דשא, סימונים, שחקנים בעמדות
 * הטקטיות שלהם, הכל נכנס בגובה אחד בלי גלילה. המסך הזה צייר
 * ארבע שורות שטוחות ("שוער", "הגנה"…) על מלבן דשא, עם לוחיות
 * שם לבנות מהפלטה הישנה, והוא נגלל.
 *
 * התוצאה: אותו הרכב בדיוק נראה כמו שני דברים שונים לפני ואחרי
 * ההגשה. משתמש שבנה 4-3-3 וראה אותו על מגרש, לחץ "שמירה", וקיבל
 * רשימה. זה קורא כאילו משהו **נלקח** ממנו ברגע ההגשה — בדיוק
 * ההפך מהמסר.
 *
 * עכשיו: אותו `<Pitch>`, אותו `fit="height"`, אותה אנטומיית
 * כרטיס (סמל · שם · שורה שלישית). ההבדל היחיד בין המסכים הוא
 * שכאן אי אפשר לגעת — וזה נאמר בשקט, דרך היעדר הכפתורים.
 *
 * ★ מה השורה השלישית מציגה
 *
 * לפני הפרסום — קיצור הקבוצה, בדיוק כמו במסך הבחירה.
 * אחרי הפרסום — הנקודות של השחקן. אותה משבצת, ולכן ההרכב לא
 * "קופץ" ברגע שהתוצאות נכנסות; הוא רק מתמלא במשמעות.
 */
import { useState } from 'react';
import { Pitch } from './Pitch.tsx';
import { Signed } from './ScoreBreakdown.tsx';
import { lineText, eventBadges, type EventBadge } from '../lib/scoring/labels.ts';
import type { ScoreLine } from '../lib/scoring/types.ts';
import { TeamCrest } from './TeamCrest.tsx';
import { Footballer } from './Footballer.tsx';
import { PRESS } from '../lib/pressPalette.ts';
import { modeTheme } from '../lib/modeTheme.ts';
import type { ModeId } from '../lib/modeTheme.ts';
import type { PoolPlayer, TeamMeta } from './SquadPicker.tsx';
import type { Lineup, LineupScore, LineupSlot, Position } from '../lib/scoring/types.ts';
import { useI18n } from '../lib/i18n/index.tsx';
import { LOCALE_META } from '../lib/i18n/locales.ts';
import { leagueTimezone } from '../lib/leagueTz.ts';

export function LockedLineup({
  lineup, pool, teams, score, gameweekLabel, submittedAt, onUnlock, onViewCard,
  onShare, mode = 'full', live = false,
}: {
  lineup: Lineup;
  pool: PoolPlayer[];
  teams: TeamMeta[];
  /**
   * ★ מוגדר ברגע שיש ניקוד להראות — כלומר גם **במהלך** המחזור,
   *   לא רק אחרי הפרסום. זה השינוי שהופך את המגרש הנעול ממסך
   *   שאין בו כלום עד יום ראשון למסך שחוזרים אליו בשבת בערב.
   */
  score?: LineupScore;
  /** הניקוד עדיין זז. משנה תגית אחת, לא את הפריסה. */
  live?: boolean;
  gameweekLabel: string;
  submittedAt: string;
  /** מוצג רק כשמותר לבטל הגשה — כלומר לפני שהתוצאות פורסמו. */
  onUnlock?: () => void;
  onViewCard?: () => void;
  /**
   * ★ פותח מחדש את כרטיס "ההרכב השבועי".
   *
   * הכרטיס הופיע פעם אחת, מיד אחרי ההגשה, ואז נעלם לנצח. מי
   * שסגר אותו כדי לבדוק משהו — או שפשוט חזר למחרת — לא יכול
   * היה לשתף את ההרכב שלו יותר. השיתוף הוא הערוץ הזול ביותר
   * שיש למוצר, והוא היה בן־חלוף.
   */
  onShare?: () => void;
  /** קובע את צבע המסגרת של המגרש — בדיוק כמו במסך הבחירה. */
  mode?: ModeId;
  /** מספר המחזור — לשיוך המקור בקישור לאופסיידס. */
  gameweekNumber?: number;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const { t, locale } = useI18n();
  const poolById = new Map(pool.map((p) => [p.id, p]));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const pointsByPlayer = new Map((score?.players ?? []).map((p) => [p.playerId, p.subtotal]));
  const linesByPlayer = new Map((score?.players ?? []).map((p) => [p.playerId, p.lines]));

  // אזור הזמן ננעל על ישראל ולא נגזר מהמכשיר — אותו באג שתוקן
  // ב-`data/fixtures.ts`, ומאותה סיבה.
  const submittedLabel = new Date(submittedAt).toLocaleString(LOCALE_META[locale].intl, {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: leagueTimezone(),
  });

  const captain = lineup.slots.find((s) => s.isCaptain);
  const captainName = captain ? poolById.get(captain.playerId)?.nameShort : undefined;
  const theme = modeTheme(mode);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── שורת בקרה — אותה אנטומיה כמו במסך הבחירה ──
          שם צ׳יפים נפתחים לגיליונות; כאן הם רק מציגים. אותו גובה,
          אותו מרווח, אותה טיפוגרפיה. */}
      <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto px-3 py-2
                      [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Chip tone="lock">
          <LockIcon /> {t('lineup.locked.chip')}
        </Chip>
        {/* ★ תגית "חי" — רק כשהמספרים באמת זזים.
            היא לא מוצגת לפני שיש ניקוד ולא אחרי שהמחזור נסגר,
            כי תגית שדולקת תמיד מפסיקה להיות סימן. */}
        {live && score && <LiveChip />}
        <Chip>{gameweekLabel}</Chip>
        {captainName && (
          <Chip tone="captain">
            {t('lineup.locked.captain')} · <bdi>{captainName}</bdi>
          </Chip>
        )}
        <Chip>
          {t('lineup.locked.submitted')} <span dir="ltr" className="num">{submittedLabel}</span>
        </Chip>

        {score && (
          <span className="ms-auto flex shrink-0 items-baseline gap-1 rounded-full
                           bg-gold/12 px-2.5 py-1 ring-1 ring-inset ring-gold/30">
            <span dir="ltr" className="num text-[15px] leading-none text-gold-light">
              {score.totalPoints}
            </span>
            <span className="text-[10px] font-bold text-chalk-dim">{t('lineup.rival.pts')}</span>
          </span>
        )}
      </div>

      {/* ── המגרש — כל מה שנשאר, ובלי גלילה ── */}
      <div className="grid min-h-0 flex-1 place-items-center px-2 py-1">
        {/* ★★ אותו מגרש בדיוק כמו במסך הבחירה ★★

            `accent` + `frameColor={PRESS.paper}` הם מה שהופך את
            הדשא ל"מודפס על דף". בלעדיהם המגרש כאן היה מלבן ירוק
            עם טבעת אפורה — כלומר אותו הרכב, בשני עולמות ויזואליים
            שונים, לפני ואחרי ההגשה. */}
        <Pitch
          formation={lineup.formation}
          fit="height"
          accent={theme.accent}
          frameColor={PRESS.paper}
          renderSlot={(slotNo) => {
            const slot = lineup.slots.find((x) => x.slotNo === slotNo);
            if (!slot?.playerId) return null;
            const card = (
              <LockedSlotCard
                slot={slot}
                player={poolById.get(slot.playerId)}
                team={teamById.get(slot.teamId)}
                points={pointsByPlayer.get(slot.playerId)}
                lines={linesByPlayer.get(slot.playerId)}
                live={live}
              />
            );
            /* ★ לחיצה על שחקן פותחת את פירוט הניקוד שלו — כמו בפנטזי. */
            return score ? (
              <button type="button" onClick={() => setPicked(slot.playerId!)}
                      aria-label={t('lineup.locked.detailAria', { name: poolById.get(slot.playerId)?.nameShort ?? '' })}
                      className="block w-full">
                {card}
              </button>
            ) : card;
          }}
        />
      </div>

      {picked && score && (() => {
        const ps = score.players.find((x) => x.playerId === picked);
        const pl = poolById.get(picked);
        if (!ps) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-end bg-black/55" onClick={() => setPicked(null)}
               role="dialog" aria-modal="true">
            <div className="max-h-[70vh] w-full overflow-y-auto rounded-t-2xl border-t border-gold/30
                            bg-night-2 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3"
                 onClick={(e) => e.stopPropagation()}>
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-chalk-dim/40" />
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h3 className="font-press text-base font-black text-chalk">
                  <bdi>{pl?.name ?? pl?.nameShort ?? picked}</bdi>
                  {ps.isCaptain && <span className="ms-1.5 rounded bg-armband px-1 text-[10px] text-night">C</span>}
                </h3>
                <span dir="ltr" className="num text-2xl font-black text-gold">{ps.subtotal}</span>
              </div>
              {ps.lines.length === 0 ? (
                <p className="py-3 text-sm text-chalk-dim">{t('lineup.locked.noEvents')}</p>
              ) : (
                <ul className="divide-y divide-gold/10">
                  {ps.lines.map((l, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-2 py-2 text-[13px]">
                      <span className="text-chalk-2">{lineText(l.reason, l.count)}</span>
                      <Signed value={l.points} />
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" onClick={() => setPicked(null)}
                      className="tap mt-3 h-11 w-full rounded-full border border-gold/35 text-sm font-bold text-gold-light">
                {t('lineup.close')}
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── CTA — אותו סרגל תחתון של מסך הבחירה ── */}
      <div className="shrink-0 border-t border-gold/15 bg-night/95 px-4
                      pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2.5 backdrop-blur">
        {/*
          ★★ שורת השיתוף — קבועה, בכל שלושת המצבים ★★

          קודם השיתוף היה אירוע חד־פעמי: כרטיס שקפץ מיד אחרי
          ההגשה ונעלם. מי שסגר אותו — סגר אותו לתמיד.

          זה בזבוז של הערוץ הזול ביותר שיש למוצר. ההרכב הוא
          הדבר היחיד כאן שמישהו רוצה **להראות**, והרגע שבו הוא
          רוצה להראות אותו הוא לא בהכרח השנייה שאחרי ההגשה — הוא
          כשחבר שואל, כששולחים לקבוצה, כשהמחזור מתקרב.

          זו לא כרזה ולא באנר: שורה אחת של פעולה, באותו גובה של
          כפתור משני, מעל ה-CTA הראשי ולא במקומו.
        */}
        {onShare && (
          <button
            onClick={onShare}
            className="tap mb-2 flex h-11 w-full items-center justify-center gap-2
                       rounded-full border border-gold/35 text-[13px] font-bold text-gold-light
                       transition-colors duration-200 ease-brand active:bg-gold/10"
          >
            <ShareIcon />
            {t('lineup.locked.share')}
          </button>
        )}

        {score && onViewCard ? (
          <button
            onClick={onViewCard}
            className="tap h-14 w-full rounded-full bg-gradient-to-b from-gold-light to-gold
                       font-poster text-xl text-gold-ink transition-transform
                       duration-200 ease-brand active:scale-[.98]"
          >
            {live ? t('lineup.locked.myScoreLive') : t('lineup.locked.viewCard')}
          </button>
        ) : onUnlock ? (
          <>
            {/* ★ ההסבר לפני הכפתור, לא אחריו.
                "ביטול הגשה" נשמע הרסני. מי שלא יודע שאפשר להגיש
                שוב — לא ילחץ, וייתקע עם הרכב שהוא כבר לא רוצה. */}
            <p className="mb-2 text-center text-[11px] leading-snug text-chalk-dim">
              {t('lineup.locked.unlockNote')}
            </p>
            <button
              onClick={onUnlock}
              className="tap h-12 w-full rounded-full border border-flare/40 text-sm
                         font-bold text-flare transition-colors duration-200 ease-brand
                         active:bg-flare/10"
            >
              {t('lineup.locked.unlock')}
            </button>
          </>
        ) : (
          <p className="py-1 text-center text-xs text-chalk-dim">
            {/* ★ ההבטחה הישנה הייתה "בסיום המחזור". היא כבר לא
                נכונה: הניקוד נכנס עם כל משחק שנגמר, וההבטחה
                צריכה להגיד את זה — אחרת אף אחד לא יחזור לבדוק. */}
            {t('lineup.locked.autoScore')}
          </p>
        )}

        {/* ★ המסך היחיד שבו למשתמש **אין מה לעשות** עד שבת.
            רצועה אחת, אמביינטית, בלי לקטוע כלום. */}
      </div>
    </div>
  );
}

/* ================================================================== */

/**
 * ★ תגית "חי".
 *
 * נקודה אחת שנושמת, ומילה אחת. לא אנימציה גדולה ולא צבע נוסף
 * לפלטה — הצהוב כאן הוא `PRESS.mark`, אותו צהוב של המספרים על
 * המגרש, ולכן העין קושרת בין התגית לבין מה שהיא מדברת עליו.
 */
function LiveChip() {
  const { t } = useI18n();
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1
                 text-[11px] font-black ring-1 ring-inset"
      style={{ background: 'rgba(245,197,24,.14)', color: PRESS.mark,
               boxShadow: 'inset 0 0 0 1px rgba(245,197,24,.38)' }}
    >
      <span
        aria-hidden="true"
        className="inline-block size-[7px] animate-pulse rounded-full"
        style={{ background: PRESS.mark }}
      />
      {t('lineup.locked.live')}
    </span>
  );
}

function Chip({
  children, tone = 'plain',
}: { children: React.ReactNode; tone?: 'plain' | 'lock' | 'captain' }) {
  const cls =
    tone === 'lock'
      ? 'bg-gold/12 text-gold-light ring-gold/30'
      : tone === 'captain'
        ? 'bg-armband/15 text-armband ring-armband/30'
        : 'bg-night-2 text-chalk-dim ring-gold/15';
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1
                  text-[11px] font-bold ring-1 ring-inset ${cls}`}
    >
      {children}
    </span>
  );
}

/** פס תגיות אירוע: שער, בישול, כרטיסים… עד שלוש, והשאר "+". פינה פיזית ימנית-תחתונה. */
function EventStrip({ badges }: { badges: EventBadge[] }) {
  if (badges.length === 0) return null;
  const shown = badges.slice(0, 3);
  const more = badges.length - shown.length;
  return (
    <span dir="ltr" className="absolute bottom-[10%] right-[-10%] z-10 flex flex-col items-end gap-px"
          aria-hidden="true">
      {shown.map((b) => (
        <span key={b.kind} className="flex items-center gap-px rounded-full px-[3px] text-[9px]
                                       font-black leading-[13px]"
              style={{ background: PRESS.paper, color: PRESS.ink, boxShadow: `0 0 0 1px ${PRESS.ink}` }}>
          <EventGlyph kind={b.kind} />
          {b.count > 1 && <span className="num">{b.count}</span>}
        </span>
      ))}
      {more > 0 && <span className="num text-[9px] font-black" style={{ color: PRESS.onGrass }}>+{more}</span>}
    </span>
  );
}

function EventGlyph({ kind }: { kind: EventBadge['kind'] }) {
  switch (kind) {
    case 'goal':       return <span>⚽</span>;
    case 'assist':     return <span>👟</span>;
    case 'save':       return <span>🧤</span>;
    case 'cleanSheet': return <span>🛡️</span>;
    case 'yellow':     return <span className="inline-block h-[9px] w-[7px] rounded-[1px]" style={{ background: '#F5C518', boxShadow: '0 0 0 .8px #12100E' }} />;
    case 'red':        return <span className="inline-block h-[9px] w-[7px] rounded-[1px]" style={{ background: '#D6342A', boxShadow: '0 0 0 .8px #12100E' }} />;
    case 'ownGoal':    return <span style={{ color: '#D6342A' }}>⚽OG</span>;
    case 'penMissed':  return <span style={{ color: '#D6342A' }}>✖P</span>;
  }
}

/** בלון ניקוד שחקן. הצבע נגזר מהערך בלבד — לא מגורם חיצוני. */
export function PointsBubble({ points, live, captain }: { points: number; live: boolean; captain: boolean }) {
  const { t } = useI18n();
  const tone = points < 0
    ? { bg: PRESS.red, fg: '#fff' }
    : points === 0
      ? { bg: '#D9D3C4', fg: PRESS.ink }
      : points >= 8
        ? { bg: '#2E9E55', fg: '#fff' }
        : { bg: PRESS.mark, fg: PRESS.ink };
  return (
    <span
      dir="ltr"
      role="img"
      aria-label={`${t('lineup.bubble.pts', { n: points })}${captain ? ` (${t('lineup.locked.captain')})` : ''}${live ? `, ${t('lineup.locked.live')}` : ''}`}
      title={live ? t('lineup.bubble.live') : t('lineup.bubble.final')}
      className={`num absolute -top-[6%] left-[-8%] z-10 grid min-w-[22px] place-items-center
                  rounded-full px-1 text-[12px] font-black leading-none
                  ${live ? 'animate-pulse' : ''}`}
      style={{ height: 22, background: tone.bg, color: tone.fg,
               boxShadow: `0 0 0 1.6px ${PRESS.ink}, 0 1px 3px rgba(0,0,0,.35)` }}
    >
      {points}
    </span>
  );
}

/**
 * כרטיס שחקן — קריאה בלבד.
 *
 * ★ הפרופורציות זהות ל-`SlotCard` של מסך הבחירה: סמל ברוחב 62%
 *   מהכרטיס, לוחית שם, ושורה שלישית. אם אחד מהם ישתנה — צריך
 *   לשנות גם את השני, אחרת שני המסכים יתחילו להיפרד שוב.
 */
export function LockedSlotCard({
  slot, player, team, points, lines, live = false,
}: {
  /** שורות הניקוד של השחקן — מהן נגזרות תגיות האירוע. */
  lines?: ScoreLine[];
  slot: LineupSlot;
  player?: PoolPlayer;
  team?: TeamMeta;
  points?: number;
  /** צובע את תג הנקודות בצהוב הסימון כשהמספר עדיין יכול לזוז. */
  live?: boolean;
}) {
  if (!player) return null;

  const cap = !!slot.isCaptain;
  const vice = !!slot.isVice;

  return (
    <div className="flex w-full flex-col items-center gap-1">
      {/*
        ★★ הדמות המצוירת, בדיוק כמו במסך הבחירה ובכרטיס ★★

        כאן ישב קודם סמל המועדון לבדו על לוחית לבנה. אותו הרכב
        נראה כך כמו קבוצת לוגואים ולפני ההגשה כמו קבוצת שחקנים —
        וההבדל הזה נקרא כאילו משהו נלקח ברגע הנעילה.

        ההבדל היחיד שנשאר בין המסכים הוא שכאן אין כפתורים.
      */}
      <span className="relative grid w-[86%] max-w-[62px] place-items-center">
        <Footballer
          teamId={slot.teamId}
          position={slot.position}
          shirt={player.shirt ?? null}
          captain={cap}
          vice={vice}
        />
        <span
          className="absolute bottom-[14%] grid size-[36%] max-w-[20px] place-items-center
                     rounded-full"
          style={{ insetInlineEnd: '0%', background: PRESS.card, boxShadow: `0 0 0 1.4px ${PRESS.ink}` }}
        >
          <TeamCrest teamId={slot.teamId} short={team?.short} size="fluid" />
        </span>

        {/* ★ בלון הנקודות — בהשראת פנטזי: עיגול בפינה העליונה של השחקן,
            גדול וקריא מרחוק, צבוע לפי הערך: ירוק-צהוב = יום טוב, אפור = כלום,
            אדום = ניקוד שלילי. בזמן חי הוא עם טבעת פועמת. פינה פיזית (שמאל)
            כי הדמות והמספר שלה לא מתהפכים ב-RTL. */}
        {points !== undefined && <PointsBubble points={points} live={live} captain={cap} />}
        {lines && <EventStrip badges={eventBadges(lines)} />}
      </span>

      {/* לוחית שם — נייר עם קו מתאר, כמו כותרת קטנה בעיתון */}
      <bdi
        className="w-full truncate rounded-[2px] px-1 py-px text-center text-[9.5px]
                   font-black leading-[1.4]"
        style={{ background: PRESS.paper, color: PRESS.ink, boxShadow: `0 0 0 1.4px ${PRESS.ink}` }}
      >
        {player.nameShort}
      </bdi>

      {/* השורה השלישית נשארת הקבוצה — תמיד. הנקודות עברו לדמות,
          ולכן אין יותר משבצת שמחליפה משמעות באמצע המחזור. */}
      <span
        className="w-full truncate rounded-[2px] px-1 text-center text-[8.5px]
                   font-black leading-[1.5]"
        style={{ background: 'rgba(239,243,230,.72)', color: PRESS.onGrass }}
      >
        {team?.short}
      </span>
    </div>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M8 10.5V2.6M8 2.6 5.4 5.2M8 2.6l2.6 2.6" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.2 8.6v4.2c0 .6.5 1 1 1h7.6c.6 0 1-.4 1-1V8.6" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 14 14" width="11" height="11" fill="none" aria-hidden="true">
      <rect x="2.5" y="6" width="9" height="6.5" rx="1.4" fill="currentColor" />
      <path d="M4.6 6V4.4a2.4 2.4 0 0 1 4.8 0V6" stroke="currentColor"
            strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/** נשאר כדי שקוד קיים שמייבא את השם לא יישבר. */
export type { Position };
