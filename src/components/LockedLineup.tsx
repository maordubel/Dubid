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
import { Pitch } from './Pitch.tsx';
import { HouseStrip } from './HouseAds.tsx';
import { TeamCrest } from './TeamCrest.tsx';
import { Footballer } from './Footballer.tsx';
import { PRESS } from '../lib/pressPalette.ts';
import { modeTheme } from '../lib/modeTheme.ts';
import type { ModeId } from '../lib/modeTheme.ts';
import type { PoolPlayer, TeamMeta } from './SquadPicker.tsx';
import type { Lineup, LineupScore, LineupSlot, Position } from '../lib/scoring/types.ts';

export function LockedLineup({
  lineup, pool, teams, score, gameweekLabel, submittedAt, onUnlock, onViewCard,
  onShare, mode = 'full', gameweekNumber = 0,
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
  const poolById = new Map(pool.map((p) => [p.id, p]));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const pointsByPlayer = new Map((score?.players ?? []).map((p) => [p.playerId, p.subtotal]));

  // אזור הזמן ננעל על ישראל ולא נגזר מהמכשיר — אותו באג שתוקן
  // ב-`data/fixtures.ts`, ומאותה סיבה.
  const submittedLabel = new Date(submittedAt).toLocaleString('he-IL', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Jerusalem',
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
          <LockIcon /> נעול
        </Chip>
        <Chip>{gameweekLabel}</Chip>
        {captainName && (
          <Chip tone="captain">
            קפטן · <bdi>{captainName}</bdi>
          </Chip>
        )}
        <Chip>
          הוגש <span dir="ltr" className="num">{submittedLabel}</span>
        </Chip>

        {score && (
          <span className="ms-auto flex shrink-0 items-baseline gap-1 rounded-full
                           bg-gold/12 px-2.5 py-1 ring-1 ring-inset ring-gold/30">
            <span dir="ltr" className="num text-[15px] leading-none text-gold-light">
              {score.totalPoints}
            </span>
            <span className="text-[10px] font-bold text-chalk-dim">נק׳</span>
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
            return (
              <LockedSlotCard
                slot={slot}
                player={poolById.get(slot.playerId)}
                team={teamById.get(slot.teamId)}
                points={pointsByPlayer.get(slot.playerId)}
              />
            );
          }}
        />
      </div>

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
            שיתוף ההרכב — סטורי, וואטסאפ או קישור
          </button>
        )}

        {score && onViewCard ? (
          <button
            onClick={onViewCard}
            className="tap h-14 w-full rounded-full bg-gradient-to-b from-gold-light to-gold
                       font-poster text-xl text-gold-ink transition-transform
                       duration-200 ease-brand active:scale-[.98]"
          >
            לצפייה בכרטיס המלא
          </button>
        ) : onUnlock ? (
          <>
            {/* ★ ההסבר לפני הכפתור, לא אחריו.
                "ביטול הגשה" נשמע הרסני. מי שלא יודע שאפשר להגיש
                שוב — לא ילחץ, וייתקע עם הרכב שהוא כבר לא רוצה. */}
            <p className="mb-2 text-center text-[11px] leading-snug text-chalk-dim">
              ההרכב נעול עד הדדליין. אפשר לבטל, לערוך, ולהגיש שוב —
              כמה פעמים שרוצים.
            </p>
            <button
              onClick={onUnlock}
              className="tap h-12 w-full rounded-full border border-flare/40 text-sm
                         font-bold text-flare transition-colors duration-200 ease-brand
                         active:bg-flare/10"
            >
              ביטול הגשה ועריכה מחדש
            </button>
          </>
        ) : (
          <p className="py-1 text-center text-xs text-chalk-dim">
            הניקוד יופיע כאן ברגע שהמחזור יסתיים ויפורסם.
          </p>
        )}

        {/* ★ המסך היחיד שבו למשתמש **אין מה לעשות** עד שבת.
            רצועה אחת, אמביינטית, בלי לקטוע כלום. */}
        <HouseStrip
          placement="locked"
          gameweekNumber={gameweekNumber}
          className="mt-2"
        />
      </div>
    </div>
  );
}

/* ================================================================== */

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

/**
 * כרטיס שחקן — קריאה בלבד.
 *
 * ★ הפרופורציות זהות ל-`SlotCard` של מסך הבחירה: סמל ברוחב 62%
 *   מהכרטיס, לוחית שם, ושורה שלישית. אם אחד מהם ישתנה — צריך
 *   לשנות גם את השני, אחרת שני המסכים יתחילו להיפרד שוב.
 */
function LockedSlotCard({
  slot, player, team, points,
}: {
  slot: LineupSlot;
  player?: PoolPlayer;
  team?: TeamMeta;
  points?: number;
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

        {/* ★ הנקודות יושבות על הדמות, במקום שבו המחיר יושב במסך
            הבחירה. אותה פינה בדיוק — ולכן הכרטיס לא משנה גובה
            כשהתוצאות נכנסות, והמגרש לא מתכווץ. */}
        {points !== undefined && (
          <span
            className="num absolute bottom-[14%] rounded-[2px] px-[3px] text-[8.5px]
                       font-black leading-[1.5]"
            dir="ltr"
            style={{ insetInlineStart: '0%', background: PRESS.ink, color: PRESS.mark }}
          >
            {points}
          </span>
        )}
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
