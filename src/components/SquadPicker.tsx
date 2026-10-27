/**
 * SquadPicker.tsx — בחירת סגל עם מפת כיסוי קבוצות.
 *
 * הרעיון המרכזי: המשתמש לא אמור *לגלות* את החוק דרך הודעת שגיאה.
 * הוא אמור לראות אותו כל הזמן. לכן מעל המגרש יש רצועת "כיסוי קבוצות"
 * שמראה בכל רגע אילו מ-14 הקבוצות כבר מיוצגות ואילו עוד פנויות,
 * ובגיליון הבחירה שחקנים מקבוצה תפוסה מוצגים נעולים ולא נעלמים —
 * ככה המשתמש מבין למה, ורואה את מי הוא צריך להחליף.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  teamCoverage, validateLineup, formatIssue, teamBlock,
} from '../lib/scoring/validate.ts';
import { Footballer } from './Footballer.tsx';
import { teamColor } from '../data/teamColors.ts';
import { TeamCrest } from './TeamCrest.tsx';
import { TeamTag } from './TeamTag.tsx';
import { Pitch } from './Pitch.tsx';
import { FormationPicker } from './FormationPicker.tsx';
import {
  formationsFor, HUD_W_PX, HUD_W_CQW, HUD_H, HUD_INSET,
} from '../lib/formation.ts';
import { PRESS } from '../lib/pressPalette.ts';
import { modeTheme } from '../lib/modeTheme.ts';
import type { RuleSet } from '../lib/scoring/rules.ts';
import type { Lineup, LineupSlot, Position } from '../lib/scoring/types.ts';
import { useI18n } from '../lib/i18n/index.tsx';
import type { DictKey } from '../lib/i18n/dict.ts';

export interface PoolPlayer {
  id: string;
  teamId: string;
  position: Position;
  name: string;         // כבר מותאם לשפת המשתמש בשרת
  nameShort: string;
  /** מספר חולצה. מוצג בעיגול על הדמות המצוירת. */
  shirt?: number | null;
  form?: number;
  price?: number;
  /** ★ D09: מצב זמינות מהשרת. undefined = כשיר. */
  status?: 'injured' | 'suspended';
}

export interface TeamMeta {
  id: string;
  short: string;        // 'מ״ח'
  name: string;         // 'מכבי חיפה'
  color?: string;
}

const POSITION_KEY: Record<Position, DictKey> = {
  GK: 'lineup.pos.GK', DEF: 'lineup.pos.DEF', MID: 'lineup.pos.MID', FWD: 'lineup.pos.FWD',
};

export interface SquadPickerProps {
  lineup: Lineup;
  pool: PoolPlayer[];
  teams: TeamMeta[];
  rules: RuleSet;
  onAssign: (slotNo: number, player: PoolPlayer) => void;
  onClear: (slotNo: number) => void;
  onCaptain: (playerId: string) => void;
  onSubmit: () => void;
  /** קיצור היריבה במחזור הנוכחי, לפי מזהה קבוצה — "נגד מי משחקים" בגיליון הבחירה. */
  opponentShortByTeam?: Record<string, string>;
  /** ★ U02/M04: שם מלא + בית/חוץ + שעה — לשורות בגיליון הבחירה. */
  opponentLongByTeam?: Record<string, string>;
  /** מצב 5 על 5: מציג עמודת/תג מחיר ליד כל שחקן, בבורר ובמגרש. */
  pricing?: boolean;
  /**
   * תקציב במיליוני יורו. כשהוא מוגדר, הבורר הופך לאילוץ חי:
   * מחוון תקציב דביק, ושחקנים יקרים מדי מסומנים כלא זמינים.
   */
  budget?: number;
  /** בחירת סגן קפטן. בלי זה תג ה-V לא מוצג. */
  onVice?: (playerId: string) => void;
  /** החלפת מערך טקטי. בלי זה הבורר לא מוצג. */
  onFormation?: (formation: string) => void;
  /** שחקנים שנפלו בהחלפת המערך האחרונה — מוצגים כהודעה. */
  droppedNames?: string[];
  /** מצב המשחק. קובע את פס הזהות בקצה המגרש ואת נוסח הטקטיקה. */
  mode?: 'five' | 'full';
}

export function SquadPicker(props: SquadPickerProps) {
  const {
    lineup, pool, teams, rules, onAssign, onClear, onCaptain, onSubmit,
    opponentShortByTeam, opponentLongByTeam, pricing, budget, onVice, onFormation, droppedNames,
    mode = 'full',
  } = props;
  const { t, locale } = useI18n();
  const [picking, setPicking] = useState<LineupSlot | null>(null);
  /** ★ נייד: לחיצה על שחקן שנבחר פותחת פעולות (קפטן/סגן/החלפה/הסרה). */
  const [acting, setActing] = useState<number | null>(null);
  const [sheet, setSheet] = useState<'teams' | 'formation' | 'budget' | null>(null);

  /** הודעה חולפת אחת. עדיפה על ערימת התראות שדוחפת את המגרש. */
  const notice = droppedNames && droppedNames.length > 0
    ? t('lineup.picker.formationChanged', { names: droppedNames.join(', ') })
    : null;

  // ★ מקור אמת אחד לעלות. חושב כאן ולא מתקבל כ-prop, כי אחרת
  //   המחוון והבדיקה "אפשר להרשות?" יכולים להיפרד — וזה בדיוק
  //   הבאג שבו המשתמש רואה "נשארו 3M" ומקבל שגיאת חריגה.
  const priceById = useMemo(() => new Map(pool.map((p) => [p.id, p.price ?? 0])), [pool]);
  const spent = useMemo(
    () => lineup.slots.reduce((sum, s) => sum + (s.playerId ? priceById.get(s.playerId) ?? 0 : 0), 0),
    [lineup.slots, priceById],
  );
  const remaining = budget !== undefined ? budget - spent : undefined;

  const filled = lineup.slots.filter((s) => s.playerId).length;
  const issues = useMemo(() => validateLineup(lineup, rules), [lineup, rules]);
  const theme = modeTheme(mode);
  const ready = issues.length === 0;

  const coverage = useMemo(
    () => teamCoverage(lineup, teams.map((t) => t.id), rules),
    [lineup, teams, rules],
  );
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  /**
   * ★ המהפך במובייל.
   *
   * מה היה: כותרת, רצועת כיסוי, פס תקציב ובורר מערכים — כל אחד
   * שורה מלאה, בזה אחר זה. יחד הם בלעו את חצי המסך, המגרש נדחף
   * מתחת לקפל, והמשתמש ראה חצי מגרש שנגלל.
   *
   * מה עכשיו: **שורת בקרה אחת** של צ׳יפים. כל צ׳יפ מציג את המספר
   * שחשוב (3/14 · 4.0M · 2-1-1) ונפתח לגיליון בלחיצה. כל מה
   * שנחסך הולך למגרש.
   *
   * המגרש מקבל `fit="height"` — הוא ממלא בדיוק את מה שנשאר
   * ונראה במלואו. אין גלילה במסך הזה בכלל.
   */
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ControlBar
        coverage={coverage}
        filled={filled}
        size={rules.constraints.lineupSize}
        formation={lineup.formation}
        canChangeFormation={!!onFormation && formationsFor(rules.constraints.lineupSize).length > 1}
        onOpen={setSheet}
      />

      {/* ---- המגרש — כל מה שנשאר, ובלי גלילה ---- */}
      <div className="grid min-h-0 flex-1 place-items-center px-2 py-2">
        {/* ★ שוליים של נייר סביב הדשא.
            בכרטיס העיתון המגרש מודפס על הדף, ומה שהופך אותו
            ל"מודפס" הוא בדיוק השוליים הבהירים סביבו. בלעדיהם
            הוא סתם מלבן ירוק שמרחף על רקע כהה. */}
        <Pitch
          formation={lineup.formation}
          fit="height"
          accent={theme.accent}
          frameColor={PRESS.paper}
          overlay={budget !== undefined ? (
            <BudgetHud
              budget={budget}
              spent={spent}
              filled={filled}
              size={rules.constraints.lineupSize}
              onOpen={() => setSheet('budget')}
            />
          ) : undefined}
          renderSlot={(slotNo) => {
            const slot = lineup.slots.find((x) => x.slotNo === slotNo);
            if (!slot) return null;
            return (
              <SlotCard
                slot={slot}
                player={pool.find((p) => p.id === slot.playerId)}
                team={teamById.get(slot.teamId)}
                pricing={pricing}
                opponent={slot.teamId ? opponentShortByTeam?.[slot.teamId] : undefined}
                onPick={() => setPicking(slot)}
                onOpen={() => setActing(slot.slotNo)}
              />
            );
          }}
        />
      </div>

      {/* ---- CTA + הודעות ---- */}
      {/*
        ★ ההודעה עוגנת ל-CTA, לא למסך.
        קודם היא הייתה `absolute bottom-[7.5rem]` בלי אב ממוקם — כלומר
        מרחק קסם מתחתית ה-viewport, שנשבר בכל שינוי גובה של הניווט או
        של סרגל הכתובות. עכשיו `bottom-full` על אב `relative`: תמיד
        בדיוק מעל הכפתור, בלי מספרים.
      */}
      <div className="relative shrink-0 border-t border-gold/15 bg-night/95 px-4 pb-3 pt-2.5 backdrop-blur">
        {(notice || (!ready && filled === rules.constraints.lineupSize)) && (
          <div className="pointer-events-none absolute inset-x-0 bottom-full z-10 px-4 pb-2">
            <p
              role={notice ? 'status' : 'alert'}
              className={`mx-auto max-w-sm rounded-xl px-3 py-2 text-center text-xs
                          shadow-lg backdrop-blur ${
                            notice ? 'bg-armband/90 text-night' : 'bg-flare/90 text-white'
                          }`}
            >
              {notice ?? formatIssue(issues[0], locale)}
            </p>
          </div>
        )}
        <button
          onClick={onSubmit}
          disabled={!ready}
          className="tap h-12 w-full rounded-2xl bg-gold font-poster text-lg text-night
                     transition-transform duration-200 ease-brand active:scale-[.98]
                     disabled:bg-night-3 disabled:text-chalk-dim"
        >
          {ready
            ? t('lineup.picker.lock')
            : filled < rules.constraints.lineupSize
              ? t('lineup.picker.remaining', { n: rules.constraints.lineupSize - filled })
              /* ★ U06: מלא אבל לא מוכן — אומרים מה חסר באמת, לא "0 שחקנים". */
              : issues[0]?.code === 'captain_missing'
                ? t('lineup.picker.needCaptain')
                : t('lineup.picker.fixFirst', { why: formatIssue(issues[0], locale) })}
        </button>
      </div>

      {/* ---- גיליונות הבקרה ---- */}
      {sheet === 'teams' && (
        <ControlSheet title={t('lineup.picker.coverage')} onClose={() => setSheet(null)}>
          <TeamCoverageGrid coverage={coverage} teamById={teamById} />
        </ControlSheet>
      )}
      {sheet === 'formation' && onFormation && (
        <ControlSheet title={t('lineup.picker.tactics')} onClose={() => setSheet(null)}>
          <FormationPicker
            options={formationsFor(rules.constraints.lineupSize)}
            value={lineup.formation}
            onChange={(f) => { onFormation(f); setSheet(null); }}
          />
        </ControlSheet>
      )}
      {sheet === 'budget' && budget !== undefined && (
        <ControlSheet title={t('lineup.picker.budget')} onClose={() => setSheet(null)}>
          <BudgetDetail budget={budget} spent={spent} filled={filled}
                        size={rules.constraints.lineupSize} />
        </ControlSheet>
      )}

      {acting !== null && (() => {
        const sl = lineup.slots.find((x) => x.slotNo === acting);
        const pl = sl?.playerId ? pool.find((p) => p.id === sl.playerId) : undefined;
        if (!sl || !pl) return null;
        return (
          <PlayerActions
            slot={sl}
            player={pl}
            team={teamById.get(sl.teamId)}
            opponent={opponentLongByTeam?.[sl.teamId] || opponentShortByTeam?.[sl.teamId]}
            pricing={pricing}
            onClose={() => setActing(null)}
            onCaptain={() => { onCaptain(pl.id); setActing(null); }}
            onVice={onVice ? () => { onVice(pl.id); setActing(null); } : undefined}
            onReplace={() => { setActing(null); setPicking(sl); }}
            onRemove={() => { onClear(sl.slotNo); setActing(null); }}
          />
        );
      })()}

      {picking && (
        <PlayerSheet
          slot={picking}
          pool={pool}
          teamById={teamById}
          lineup={lineup}
          rules={rules}
          onClose={() => setPicking(null)}
          onSelect={(p) => { onAssign(picking.slotNo, p); setPicking(null); }}
          opponentShortByTeam={opponentShortByTeam}
          opponentLongByTeam={opponentLongByTeam}
          pricing={pricing}
          remaining={remaining}
          teams={teams}
        />
      )}
    </div>
  );
}

/* ================================================================== */
/* שורת הבקרה                                                          */
/* ================================================================== */

/**
 * ★ שורה אחת, שלושה מספרים, אפס בזבוז.
 *
 * כל צ׳יפ עונה על שאלה אחת שהמשתמש שואל תוך כדי בנייה:
 *   "כמה קבוצות תפסתי?" · "באיזה מערך אני?"
 *
 * התשובה גלויה תמיד; הפירוט נפתח בלחיצה. זה מה שמשחרר את
 * המסך למגרש במקום שלוש רצועות שאף אחת מהן לא נקראת עד הסוף.
 *
 * ★ התקציב **יצא מכאן**, בכוונה.
 *
 * הוא עבר לחלון מרחף מעל המגרש. צ׳יפ שלישי שנקרא "תקציב" נראה
 * בדיוק כמו שני האחרים, והעין מדלגת עליו — בזמן שהתקציב הוא
 * האילוץ היחיד שנוכח בכל לחיצה בדוביד 5.
 */
function ControlBar({
  coverage, filled, size, formation, canChangeFormation, onOpen,
}: {
  coverage: ReturnType<typeof teamCoverage>;
  filled: number;
  size: number;
  formation: string;
  canChangeFormation: boolean;
  onOpen: (sheet: 'teams' | 'formation' | 'budget') => void;
}) {
  const { t } = useI18n();
  const used = coverage.filter((c) => c.filled).length;

  return (
    <div className="shrink-0 border-b border-gold/15 bg-night px-2.5 py-2">
      <div className="mx-auto flex max-w-3xl items-stretch gap-2">
        <Chip label={t('lineup.picker.teams')} onClick={() => onOpen('teams')}>
          <span className="num" dir="ltr">{used}/{coverage.length}</span>
        </Chip>

        {/*
          ★★ "לא ידעתי שאפשר לשנות טקטיקה." ★★

          הצ׳יפ הקודם הציג `4-3-3` מתחת לתווית "מערך" — כלומר
          **מצב**, לא פעולה. הוא נראה בדיוק כמו הצ׳יפ שלידו
          שמציג מספר, ולכן איש לא ניסה ללחוץ עליו.

          שלושה שינויים, וכל אחד מהם עומד בפני עצמו:
            · "טקטיקה" ולא "מערך" — זו המילה שמשתמש חושב בה.
            · מסגרת זהב + חץ — הצ׳יפ נראה כמו כפתור, לא כמו נתון.
            · "החלף" כתוב במפורש. אפשרות שצריך לגלות היא
              אפשרות שרוב האנשים לא ימצאו.
        */}
        <button
          onClick={() => onOpen('formation')}
          disabled={!canChangeFormation}
          aria-label={t('lineup.picker.tacticsAria', { formation })}
          className="tap flex flex-[1.35] items-center justify-center gap-2 rounded-xl border
                     border-gold/45 bg-gold/10 px-2 py-1.5 text-gold
                     transition-colors duration-200 ease-brand
                     active:bg-gold/20 disabled:border-gold/15 disabled:bg-night-2
                     disabled:text-chalk-dim"
        >
          <span className="flex flex-col items-start leading-none">
            <span className="text-[9px] font-bold tracking-wide opacity-80">{t('lineup.picker.tactic')}</span>
            <span className="num text-sm font-black leading-tight" dir="ltr">{formation}</span>
          </span>
          {canChangeFormation && (
            <span className="flex items-center gap-0.5">
              <span className="text-[9.5px] font-black">{t('lineup.picker.change')}</span>
              <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor"
                   strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </span>
          )}
        </button>

        <div className="grid shrink-0 place-items-center rounded-xl bg-night-2 px-3">
          <span className="num text-sm font-black text-gold" dir="ltr">{filled}/{size}</span>
        </div>
      </div>
    </div>
  );
}

/** משפט עם ערך בתוך <span class=num> — מפצלים סביב {n}. */
function withNum(tpl: string, n: string | number, cls = '') {
  const [a, b = ''] = tpl.split('{n}');
  return <>{a}<span className={`num ${cls}`.trim()} dir="ltr">{n}</span>{b}</>;
}

function Chip({
  label, children, onClick, alert = false,
}: { label: string; children: ReactNode; onClick: () => void; alert?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={[
        'tap flex flex-1 flex-col items-center justify-center rounded-xl px-2 py-1.5',
        'transition-colors duration-200 ease-brand',
        alert ? 'bg-flare/15 text-flare' : 'bg-night-2 text-chalk active:bg-night-3',
      ].join(' ')}
    >
      <span className="text-[9px] font-bold tracking-wide text-chalk-dim">{label}</span>
      <span className="text-sm font-black leading-tight">{children}</span>
    </button>
  );
}

/* ================================================================== */
/* חלון התקציב המרחף                                                   */
/* ================================================================== */

/**
 * ★★ למה חלון מרחף ולא עוד שורה במסך ★★
 *
 * בדוביד 5 התקציב אינו "מידע נוסף" — הוא **החוק**. כל בחירה
 * היא שאלה אחת: "אני יכול להרשות לעצמי את זה?" מספר שנמצא
 * ברצועה עליונה עונה על השאלה רק למי שזוכר להרים את העיניים
 * לפני כל לחיצה, וזה לא מה שאנשים עושים.
 *
 * החלון מרחף בפינה התחתונה של המגרש — אותו מקום בדיוק שבו
 * יושבת תיבת המקרא בכרטיס העיתון, ובאותה שפה גרפית: נייר,
 * דיו, מסגרת. הוא חלק מהמגרש, לא ממשק שהודבק עליו.
 *
 * ★ למה דווקא הפינה התחתונה־שמאלית
 *
 * שם אין שחקנים. השוער יושב במרכז התחתון, וקו ההגנה מתחיל
 * גבוה ממנו. בדקנו את כל המערכים המותרים: אף כרטיס לא מגיע
 * לפינה הזו.
 *
 * ★ שלוש שכבות מידע, לפי הסדר שבו הן נחוצות
 *
 *   1. הסכום שנותר — גדול. זו התשובה.
 *   2. פס — כמה מהתקציב כבר הלך. זה ההקשר.
 *   3. "עד X לכל אחד מ-N" — זו ה**החלטה** הבאה, והיא הדבר
 *      היחיד כאן שהמשתמש לא יכול לחשב בראש תוך כדי.
 */
function BudgetHud({
  budget, spent, filled, size, onOpen,
}: {
  budget: number;
  spent: number;
  filled: number;
  size: number;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const remaining = budget - spent;
  const over = remaining < 0;
  const left = size - filled;
  const perPlayer = left > 0 ? remaining / left : null;
  const pct = Math.max(0, Math.min(100, (spent / budget) * 100));

  return (
    <button
      onClick={onOpen}
      aria-label={t('lineup.picker.budgetAria', { left: remaining.toFixed(1), budget })}
      className="absolute z-10 flex flex-col justify-center rounded-[3px] px-1.5 text-start
                 transition-transform duration-200 ease-brand active:scale-[.97]"
      style={{
        /* ★ המידות מגיעות מ-`lib/formation.ts` ולא נכתבות כאן.
           שם הן נבדקות מול כל מערך ובכל רוחב מגרש — כאן הן רק
           מוצגות. שני מספרים נפרדים היו נפרדים ביום שמישהו
           יגדיל את החלון "רק קצת". */
        insetInlineEnd: HUD_INSET,
        bottom: HUD_INSET,
        height: HUD_H,
        width: `min(${HUD_W_PX}px, ${HUD_W_CQW * 100}cqw)`,
        background: PRESS.card,
        boxShadow: `inset 0 0 0 2px ${over ? PRESS.red : PRESS.ink}, 0 3px 10px -3px rgba(0,0,0,.65)`,
      }}
    >
      <span className="flex items-baseline gap-1 leading-none">
        <span
          className="num text-[17px] font-black"
          dir="ltr"
          style={{ color: over ? PRESS.red : PRESS.ink }}
        >
          {remaining.toFixed(1)}M
        </span>
        <span
          className="text-[8px] font-black"
          style={{ color: over ? PRESS.red : 'rgba(18,16,14,.6)' }}
        >
          {over ? t('lineup.picker.over') : t('lineup.picker.left')}
        </span>
      </span>

      {/* הפס — שני צבעי דיו, בלי גרדיאנט. אותה שפה כמו המגרש. */}
      <span
        className="mt-1 block h-[4px] w-full overflow-hidden"
        style={{ background: 'rgba(18,16,14,.14)', boxShadow: `inset 0 0 0 1px ${PRESS.ink}` }}
        aria-hidden="true"
      >
        <span
          className="block h-full transition-[width] duration-300 ease-brand"
          style={{ width: `${pct}%`, background: over ? PRESS.red : PRESS.ink }}
        />
      </span>

      {/* ★ השורה השלישית היא ה**החלטה** הבאה, ולא עוד מספר:
          כמה מותר להוציא על כל אחד מהשחקנים שנשארו. זה הדבר
          היחיד כאן שהמשתמש לא יכול לחשב בראש תוך כדי בחירה. */}
      <span
        className="mt-0.5 block truncate text-[8px] font-bold leading-none"
        style={{ color: over ? PRESS.red : 'rgba(18,16,14,.66)' }}
      >
        {over
          ? t('lineup.picker.freeUp')
          : perPlayer !== null
            ? withNum(t('lineup.picker.perPlayer'), `${perPlayer.toFixed(1)}M`)
            : withNum(t('lineup.picker.outOf'), `${budget}M`)}
      </span>
    </button>
  );
}

/* ================================================================== */
/* גיליון בקרה                                                         */
/* ================================================================== */

/** גיליון תחתון קצר. נסגר בלחיצה מחוץ אליו או ב-Escape. */
function ControlSheet({
  title, onClose, children,
}: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-sheet flex items-end bg-night/70 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[70dvh] w-full overflow-y-auto rounded-t-3xl bg-night-2 pb-[env(safe-area-inset-bottom)]
                   motion-safe:animate-slideUp lg:mx-auto lg:mb-8 lg:max-w-lg lg:rounded-3xl"
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-chalk/25" />
        <h2 className="px-4 pb-1 pt-3 font-press text-base font-black">{title}</h2>
        <div className="pb-4">{children}</div>
      </div>
    </div>
  );
}

/** רשת כיסוי הקבוצות — בגיליון, לא ברצועה שגוזלת גובה. */
function TeamCoverageGrid({
  coverage, teamById,
}: {
  coverage: ReturnType<typeof teamCoverage>;
  teamById: Map<string, TeamMeta>;
}) {
  return (
    <ul className="grid grid-cols-4 gap-2 px-4 sm:grid-cols-7">
      {coverage.map((c) => {
        const meta = teamById.get(c.teamId);
        return (
          <li
            key={c.teamId}
            title={meta?.name}
            className={[
              'flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-center',
              c.filled ? 'bg-gold/15 ring-1 ring-inset ring-gold/40' : 'bg-night-3 opacity-60',
            ].join(' ')}
          >
            <TeamCrest teamId={c.teamId} short={meta?.short} size={26} />
            <span className={`text-[10px] font-bold ${c.filled ? 'text-gold' : 'text-chalk-dim'}`}>
              {meta?.short ?? c.teamId}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** פירוט התקציב. הצ׳יפ מראה את המספר; כאן ההסבר. */
function BudgetDetail({
  budget, spent, filled, size,
}: { budget: number; spent: number; filled: number; size: number }) {
  const { t } = useI18n();
  const remaining = budget - spent;
  const over = remaining < 0;
  const left = size - filled;
  const perPlayer = left > 0 ? remaining / left : null;

  return (
    <div className="px-4">
      <div className="mb-2 h-2 overflow-hidden rounded-full bg-night-3">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ease-brand ${
            over ? 'bg-flare' : 'bg-gold'
          }`}
          style={{ width: `${Math.max(0, Math.min(100, (spent / budget) * 100))}%` }}
        />
      </div>
      <dl className="space-y-1.5 text-sm">
        <Row label={t('lineup.picker.budget')} value={`${budget}M€`} />
        <Row label={t('lineup.picker.spent')} value={`${spent.toFixed(1)}M€`} />
        <Row label={over ? t('lineup.picker.over') : t('lineup.picker.left')} value={`${remaining.toFixed(1)}M€`} accent={over} />
        {perPlayer !== null && !over && (
          <Row
            label={t('lineup.picker.perRemaining', { left })}
            value={`${perPlayer.toFixed(1)}M€`}
          />
        )}
      </dl>
    </div>
  );
}

function Row({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-chalk-dim">{label}</dt>
      <dd className={`num font-black ${accent ? 'text-flare' : 'text-chalk'}`} dir="ltr">{value}</dd>
    </div>
  );
}

/* ================================================================== */
/* משבצת שחקן                                                          */
/* ================================================================== */

/**
 * כרטיס שחקן על המגרש.
 *
 * ★ הכרטיס לא קובע את רוחבו — המגרש קובע.
 *
 * `w-full` בתוך משבצת שרוחבה `clamp(...)` הוא מה שמונע את הבאג
 * המקורי. קודם היה כאן חולצה בגודל קבוע 56 פיקסלים ולוחית שם
 * ברוחב 92, וברגע שהשורה הכילה יותר משלושה שחקנים הם נדחסו
 * זה על זה. עכשיו הכל יחסי, וגודל הסמל נגזר באחוזים.
 *
 * ★ סמל המועדון ולא חולצה
 *
 * הברִיף ביקש סמלים אמיתיים, מאותו מקור כמו אופסיידס.
 * `TeamCrest` נופל לחולצה רק לשתי הקבוצות שאין להן סמל.
 */
function SlotCard({
  slot, player, team, pricing, opponent, onPick, onOpen,
}: {
  slot: LineupSlot;
  player?: PoolPlayer;
  team?: TeamMeta;
  pricing?: boolean;
  /** ★ U07: היריבה במחזור ("MHA (H)") — נשארת גלויה גם אחרי הבחירה. */
  opponent?: string;
  onPick: () => void;
  /** ★ לחיצה על שחקן שנבחר → גיליון פעולות (קפטן, סגן, החלפה, הסרה). */
  onOpen: () => void;
}) {
  const { t } = useI18n();
  if (!player) {
    /* ★ משבצת ריקה — אותה דמות, במתאר מקווקו.
       חולצה ריקה ודמות ריקה הן שתי שפות; הדמות היא זו שאומרת
       "כאן חסר שחקן" ולא "כאן חסר פריט". */
    return (
      <button
        onClick={onPick}
        aria-label={t('lineup.picker.add', { pos: t(POSITION_KEY[slot.position]) })}
        className="tap flex w-full flex-col items-center gap-1
                   transition-transform duration-200 ease-brand active:scale-95"
      >
        <span className="relative grid w-[74%] max-w-[52px] place-items-center">
          <Footballer ghost position={slot.position} />
          <span className="absolute text-lg font-black leading-none" style={{ color: PRESS.ink }}>
            +
          </span>
        </span>
        <span
          className="w-full truncate rounded-[2px] border border-dashed px-1 py-0.5
                     text-center text-[9px] font-black"
          style={{ borderColor: 'rgba(18,16,14,.45)', background: 'rgba(239,243,230,.72)', color: PRESS.ink }}
        >
          {t(POSITION_KEY[slot.position])}
        </span>
      </button>
    );
  }

  const cap = !!slot.isCaptain;
  const vice = !!slot.isVice;
  const price = pricing && player.price !== undefined ? player.price : undefined;

  return (
    <div className="group relative flex w-full flex-col items-center gap-1">
      {/*
        ★★ הדמות המצוירת, ולא סמל המועדון ★★

        הסמל אומר "איזו קבוצה". הדמות אומרת "**שחקן** מהקבוצה
        הזו" — וזה ההבדל בין רשימת לוגואים לבין הרכב שעומד על
        הדשא. זו גם אותה דמות בדיוק שמופיעה בכרטיס השיתוף
        ובאיור של הלובי, ולכן שלושת המסכים נקראים כמוצר אחד.

        הסמל לא נעלם: הוא ירד לתג קטן בפינה, שם הוא עדיין עונה
        על "מאיזו קבוצה" במבט.
      */}
      <button
        onClick={onOpen}
        aria-label={t('lineup.picker.actionsFor', { name: player.nameShort })}
        className="tap-none relative grid w-[86%] max-w-[62px] place-items-center"
      >
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

        {/* ★ היריבה בראש הדמות — בלי שורה נוספת, כדי שהמגרש לא יתכווץ. */}
        {opponent && (
          <bdi
            className="absolute top-[3%] z-20 max-w-[150%] truncate rounded-[2px] px-[3px] text-[8px] font-black leading-[1.45] shadow-[0_1px_3px_rgba(0,0,0,.5)]"
            style={{ background: PRESS.ink, color: PRESS.paper }}
            title={opponent}
          >
            {opponent}
          </bdi>
        )}

        {/* ★ המחיר יושב על הדמות ולא בשורה משלו.
            שורה שלישית הייתה מוסיפה 17 פיקסלים לכל כרטיס, וזה
            מכריח את כל המגרש להתכווץ — ראו `CARD_ASPECT`. */}
        {price !== undefined && (
          <span
            className="num absolute bottom-[14%] rounded-[2px] px-[3px] text-[8.5px]
                       font-black leading-[1.5]"
            dir="ltr"
            style={{ insetInlineStart: '0%', background: PRESS.ink, color: PRESS.mark }}
          >
            {price}
          </span>
        )}
      </button>

      {/* לוחית שם — נייר עם קו מתאר, כמו כותרת קטנה בעיתון */}
      <button
        type="button"
        onClick={onOpen}
        tabIndex={-1}
        aria-hidden="true"
        className="w-full truncate rounded-[2px] px-1 py-px text-center text-[9.5px]
                   font-black leading-[1.4]"
        style={{ background: PRESS.paper, color: PRESS.ink, boxShadow: `0 0 0 1.4px ${PRESS.ink}` }}
      >
        <bdi>{player.nameShort}</bdi>
      </button>

      {/*
        ★★ קפטן / סגן / הסרה — בגיליון, לא בשורה מתחת לכרטיס ★★

        שורת C·V·✕ הגדילה כל כרטיס ב-20px. בטלפון נמוך השורות התנגשו:
        הכפתורים של ההגנה ישבו מעל השוער, ולחיצה על השוער (או על ה-C
        שלו) פגעה בשחקן הגנה. עכשיו הכרטיס קצר, וכל לחיצה עליו פותחת
        גיליון פעולות עם כפתורים בגודל אגודל. הסימון (C/V) נשאר על הדמות.
      */}
    </div>
  );
}

/**
 * ★ פעולות על שחקן שנבחר — גיליון תחתון עם כפתורים בגודל אגודל.
 *   מחליף את שורת C·V·✕ הזעירה שישבה מתחת לכל כרטיס ונדרסה בטלפונים נמוכים.
 */
function PlayerActions({
  slot, player, team, opponent, pricing, onClose, onCaptain, onVice, onReplace, onRemove,
}: {
  slot: LineupSlot;
  player: PoolPlayer;
  team?: TeamMeta;
  opponent?: string;
  pricing?: boolean;
  onClose: () => void;
  onCaptain: () => void;
  onVice?: () => void;
  onReplace: () => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const cap = !!slot.isCaptain;
  const vice = !!slot.isVice;
  return (
    <ControlSheet title={player.name} onClose={onClose}>
      <div className="px-4">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-chalk-dim">
          <span className="flex items-center gap-1.5">
            <TeamCrest teamId={slot.teamId} short={team?.short} size={18} />
            <bdi className="font-bold text-chalk-2">{team?.name}</bdi>
          </span>
          <span>· {t(POSITION_KEY[slot.position])}</span>
          {pricing && player.price !== undefined && <span className="num text-gold" dir="ltr">· {player.price}M€</span>}
        </p>
        {opponent && <p className="mt-1 text-[12px] text-chalk-2"><bdi>{t('lineup.picker.vs', { opp: opponent })}</bdi></p>}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onCaptain}
            aria-pressed={cap}
            className={`tap flex min-h-[52px] items-center justify-center gap-2 rounded-2xl font-black ${
              cap ? 'bg-flare text-white' : 'bg-gold text-night'}`}
          >
            <span className="grid size-6 place-items-center rounded-full bg-black/20 text-[12px]">C</span>
            {cap ? t('lineup.picker.removeCaptain') : t('lineup.picker.makeCaptain')}
          </button>
          {onVice ? (
            <button
              type="button"
              onClick={onVice}
              disabled={cap}
              aria-pressed={vice}
              className={`tap flex min-h-[52px] items-center justify-center gap-2 rounded-2xl font-black disabled:opacity-35 ${
                vice ? 'bg-tekhelet text-white' : 'border border-gold/35 text-chalk'}`}
            >
              <span className="grid size-6 place-items-center rounded-full bg-black/20 text-[12px]">V</span>
              {vice ? t('lineup.picker.removeVice') : t('lineup.picker.makeVice')}
            </button>
          ) : <span />}
          <button
            type="button"
            onClick={onReplace}
            className="tap min-h-[48px] rounded-2xl border border-gold/25 text-[13.5px] font-bold text-chalk"
          >
            {t('lineup.picker.replace')}
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="tap min-h-[48px] rounded-2xl border border-flare/40 text-[13.5px] font-bold text-flare"
          >
            {t('lineup.picker.removePlayer')}
          </button>
        </div>
      </div>
    </ControlSheet>
  );
}

/* ================================================================== */
/* גיליון בחירת שחקן                                                   */
/* ================================================================== */

function PlayerSheet({
  slot, pool, teamById, teams, lineup, rules, onClose, onSelect,
  opponentShortByTeam, opponentLongByTeam, pricing, remaining,
}: {
  slot: LineupSlot;
  pool: PoolPlayer[];
  teamById: Map<string, TeamMeta>;
  teams: TeamMeta[];
  lineup: Lineup;
  rules: RuleSet;
  onClose: () => void;
  onSelect: (p: PoolPlayer) => void;
  opponentShortByTeam?: Record<string, string>;
  opponentLongByTeam?: Record<string, string>;
  pricing?: boolean;
  /** תקציב פנוי. undefined = אין אילוץ תקציב במצב הזה. */
  remaining?: number;
}) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState('');
  /**
   * ★ שתי דרכים למצוא שחקן, ושתיהן לגיטימיות:
   *   'players' — הרשימה השטוחה, ממוינת לפי שווי. מהיר למי שיודע.
   *   'teams'   — קודם בוחרים קבוצה, אחר כך שחקן. טבעי למי שחושב
   *               "מי מנצח השבוע" ורק אז "מי משם".
   * הברִיף מבקש את השנייה ל-11 ומדגיש: לשמור את הראשונה כחלופה.
   */
  const [browse, setBrowse] = useState<'players' | 'teams'>('players');
  const [openTeam, setOpenTeam] = useState<string | null>(null);

  const nameOf = useMemo(
    () => new Map(pool.map((p) => [p.id, p.nameShort])),
    [pool],
  );

  /* ★ U05/M10: החלפה במשבצת מלאה — השחקן שיוצא משחרר את המחיר ואת המועדון
     שלו **לפני** הבדיקה. בלי זה אי אפשר היה להחליף שחקן בחבר לאותה קבוצה,
     או בשחקן יקר ממנו ב-1M כשיש 1M פנוי. */
  const outgoingPrice = slot.playerId ? (pool.find((p) => p.id === slot.playerId)?.price ?? 0) : 0;
  const budgetForSlot = remaining !== undefined ? remaining + outgoingPrice : undefined;
  const lineupWithout = useMemo<Lineup>(() => ({
    ...lineup,
    slots: lineup.slots.map((s) => (s.slotNo === slot.slotNo
      ? { ...s, playerId: '', teamId: '', isCaptain: false, isVice: false } : s)),
  }), [lineup, slot.slotNo]);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pool
      .filter((p) => p.position === slot.position)
      .filter((p) => (browse === 'teams' && openTeam ? p.teamId === openTeam : true))
      .filter((p) => {
        if (!q) return true;
        const team = teamById.get(p.teamId);
        return p.name.toLowerCase().includes(q) || (team?.name ?? '').toLowerCase().includes(q);
      })
      // ★ החסימה מגיעה מ-teamBlock, שמחזיר גם *מי* תופס את הקבוצה —
      //   כדי שנוכל לומר "כבר בחרת את אצילי" ולא רק להאפיר בלי הסבר.
      .map((p) => {
        const block = p.id === slot.playerId
          ? { blocked: true as const, occupiedBy: p.id, reasonHe: '', reasonEn: '', reasonEl: '' }
          : teamBlock(lineupWithout, p.teamId, rules);
        // ★ "יקר מדי" הוא חסימה נפרדת מ"קבוצה תפוסה", ומוצגת אחרת.
        //   מיזוג השתיים היה מסתיר מהמשתמש מה בדיוק הבעיה.
        const tooExpensive =
          budgetForSlot !== undefined && p.price !== undefined && p.price > budgetForSlot + 1e-9;
        return { p, block, tooExpensive };
      })
      // חסומים יורדים לסוף אבל לא נעלמים: משתמש צריך להבין למה, לא לחפש
      .sort((a, b) => {
        const aOut = Number(a.block.blocked || a.tooExpensive);
        const bOut = Number(b.block.blocked || b.tooExpensive);
        if (aOut !== bOut) return aOut - bOut;
        // ★ הברִיף: מיון לפי שווי, מהגבוה לנמוך. לא לפי קבוצה.
        //   השווי הוא הסיגנל החזק ביותר שיש למשתמש על איכות שחקן,
        //   ולכן הוא ברירת המחדל — לא שם וגם לא סדר אלפביתי.
        if (pricing) {
          const d = (b.p.price ?? 0) - (a.p.price ?? 0);
          if (d !== 0) return d;
        }
        const f = (b.p.form ?? 0) - (a.p.form ?? 0);
        if (f !== 0) return f;
        // שובר שוויון קבוע — הרשימה לא "רוקדת" בין פתיחות.
        return a.p.id.localeCompare(b.p.id);
      });
  }, [pool, slot.position, slot.playerId, query, lineupWithout, rules, teamById, pricing, budgetForSlot, browse, openTeam]);

  const available = candidates.filter((c) => !c.block.blocked && !c.tooExpensive).length;

  return (
    <div
      className="fixed inset-0 z-sheet flex items-end bg-night/70 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('lineup.picker.pick', { pos: t(POSITION_KEY[slot.position]) })}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[86dvh] w-full overflow-hidden rounded-t-3xl bg-night-2
                   pb-[env(safe-area-inset-bottom)] motion-safe:animate-slideUp
                   lg:mx-auto lg:mb-8 lg:max-w-lg lg:rounded-3xl"
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-chalk/25" />

        <div className="px-4 py-3">
          <div className="flex items-baseline justify-between">
            <h2 className="font-press text-lg font-black">
              {t('lineup.picker.pick', { pos: t(POSITION_KEY[slot.position]) })}
            </h2>
            <span className="text-xs text-chalk-dim">
              <span dir="ltr" className="num">{available}</span> {t('lineup.picker.available')}
            </span>
          </div>

          <p className="mt-1 text-[11px] text-chalk-dim">
            {t('lineup.picker.oneTeamNote')}
            {remaining !== undefined && (
              <>
                {' '}{withNum(t('lineup.picker.leftM'), (budgetForSlot ?? remaining).toFixed(1), 'text-gold')}
              </>
            )}
          </p>

          {/* ★ שתי דרכי חיפוש. ברירת המחדל היא הרשימה — היא מהירה
              יותר. "לפי קבוצה" קיימת למי שחושב קודם על המשחקים. */}
          <div className="mt-3 flex gap-1 rounded-full bg-night p-1">
            {([
              ['players', t('lineup.picker.byPlayer')],
              ['teams', t('lineup.picker.byTeam')],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => { setBrowse(id); setOpenTeam(null); }}
                className={`tap flex-1 rounded-full py-1.5 text-xs font-black
                            transition-colors duration-200 ease-brand ${
                              browse === id ? 'bg-gold text-night' : 'text-chalk-dim'
                            }`}
              >
                {label}
              </button>
            ))}
          </div>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('lineup.picker.search')}
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            className="tap mt-3 w-full rounded-full bg-night px-4 text-start text-chalk
                       placeholder:text-chalk-dim focus:outline-none focus:ring-2 focus:ring-gold"
          />
        </div>

        {/* ---- בחירת קבוצה ---- */}
        {browse === 'teams' && !openTeam ? (
          <TeamGrid
            teams={teams}
            pool={pool}
            position={slot.position}
            lineup={lineup}
            rules={rules}
            opponentShortByTeam={opponentShortByTeam}
            onPick={setOpenTeam}
          />
        ) : (
        <>
        {browse === 'teams' && openTeam && (
          <button
            onClick={() => setOpenTeam(null)}
            className="tap mx-4 mb-2 flex items-center gap-1.5 rounded-full bg-night px-3 py-1.5
                       text-xs font-black text-chalk-dim"
          >
            <span aria-hidden>→</span> {t('lineup.picker.allTeams')}
            <span className="text-chalk">· {teamById.get(openTeam)?.name}</span>
          </button>
        )}
        <ul className="max-h-[60dvh] overflow-y-auto overscroll-contain px-2 pb-4">
          {candidates.map(({ p, block, tooExpensive }) => {
            const team = teamById.get(p.teamId);
            const occupant = block.occupiedBy ? nameOf.get(block.occupiedBy) : undefined;
            return (
              <li key={p.id}>
                <button
                  disabled={block.blocked || tooExpensive}
                  onClick={() => onSelect(p)}
                  aria-disabled={block.blocked || tooExpensive}
                  className={[
                    'tap flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-start',
                    'transition-colors duration-200 ease-brand',
                    block.blocked
                      // ★ האפרה + קו חוצה: ברור מיד שאי אפשר, ולמה
                      ? 'cursor-not-allowed opacity-45 grayscale'
                      : tooExpensive
                        // יקר מדי הוא מצב אחר: השחקן זמין, התקציב לא.
                        // לכן מעומעם אך לא אפור — ההבדל מכוון.
                        ? 'cursor-not-allowed opacity-55'
                        : 'active:bg-night-3',
                  ].join(' ')}
                >
                  {/* ★★ הסמל, ולא ריבוע אפור. ★★
                      קודם כאן ישב ריבוע 32px בצבע `bg-night-3` עם
                      הקיצור בגודל 10px. שתי תקלות באחד: הצבע לא
                      אמר כלום (במשחק פנטזי סורקים צבעים, לא
                      קוראים), והרוחב חתך את הקיצורים החדשים —
                      `מ.נתניה` הפך ל-`מ.נת…`. */}
                  <TeamCrest
                    teamId={p.teamId}
                    short={team?.short}
                    size={34}
                    className="shrink-0"
                  />

                  <span className="min-w-0 flex-1">
                    {/* שורה 1: השם, ולידו תג הקבוצה בצבעי המועדון. */}
                    <span className="flex items-center gap-1.5">
                      <bdi className={[
                        'min-w-0 flex-1 truncate text-[14.5px] font-black',
                        block.blocked ? 'line-through decoration-flare/70' : '',
                      ].join(' ')}>
                        {p.name}
                      </bdi>
                      <TeamTag
                        teamId={p.teamId}
                        short={team?.short}
                        name={team?.name}
                        size="xs"
                        muted={block.blocked}
                      />
                    </span>

                    {/* ★ שורה 2 היא **סיבה**, לא חזרה על שם הקבוצה.
                        קודם היא פתחה ב-`team?.name` בכל מצב, ולכן
                        השם הופיע פעמיים בכל שורה ודחק את המידע
                        שבאמת מבדיל — נגד מי משחקים, ולמה חסום. */}
                    <span className="mt-0.5 block truncate text-[11.5px] text-chalk-dim">
                      {p.status && !block.blocked && (
                        <span className="me-1.5 rounded-sm bg-flare/15 px-1 py-[1px] text-[10px] font-black uppercase text-flare">
                          {t(p.status === 'injured' ? 'board.status.injured' : 'board.status.suspended')}
                        </span>
                      )}
                      {block.blocked
                        ? occupant
                          ? t('lineup.picker.alreadyPicked', { name: occupant })
                          : (locale === 'he' ? block.reasonHe : locale === 'el' ? block.reasonEl : block.reasonEn)
                        : tooExpensive
                          ? t('lineup.picker.short', { n: ((p.price ?? 0) - (budgetForSlot ?? 0)).toFixed(1) })
                          : (opponentLongByTeam?.[p.teamId] || opponentShortByTeam?.[p.teamId])
                            ? t('lineup.picker.vs', { opp: opponentLongByTeam?.[p.teamId] || opponentShortByTeam![p.teamId] })
                            : team?.name}
                    </span>
                  </span>
                  {block.blocked ? (
                    <span aria-hidden className="text-sm text-flare">✕</span>
                  ) : pricing && p.price !== undefined ? (
                    <span
                      dir="ltr"
                      className={[
                        'num shrink-0 rounded-lg px-2 py-1 text-xs font-bold',
                        tooExpensive ? 'bg-flare/15 text-flare' : 'bg-gold/15 text-gold',
                      ].join(' ')}
                    >
                      {p.price}M€
                    </span>
                  ) : p.form !== undefined ? (
                    <span dir="ltr" className="num text-sm text-gold">{p.form.toFixed(1)}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
        </>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/* בחירה לפי קבוצה                                                     */
/* ================================================================== */

/**
 * ★ הברִיף מבקש "כרטיסי קבוצה מבוססי לוגו". אין לנו לוגואים
 *   מורשים, ולכן הכרטיס בנוי מהערכה עצמה: צבע המועדון כרקע,
 *   קיצור השם בדיו שנבחר לפי ניגודיות מדודה. התוצאה מזוהה מיד
 *   ולא מפרה זכויות של אף מועדון.
 *
 * קבוצה שכבר תפוסה בהרכב מוצגת נעולה במקום להיעלם — אותו עיקרון
 * שמנחה את רשימת השחקנים.
 */
function TeamGrid({
  teams, pool, position, lineup, rules, opponentShortByTeam, onPick,
}: {
  teams: TeamMeta[];
  pool: PoolPlayer[];
  position: Position;
  lineup: Lineup;
  rules: RuleSet;
  opponentShortByTeam?: Record<string, string>;
  onPick: (teamId: string) => void;
}) {
  const { t: tt } = useI18n();
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pool) {
      if (p.position === position) m.set(p.teamId, (m.get(p.teamId) ?? 0) + 1);
    }
    return m;
  }, [pool, position]);

  return (
    <ul className="grid max-h-[60dvh] grid-cols-3 gap-2 overflow-y-auto overscroll-contain
                   px-3 pb-4 sm:grid-cols-4">
      {teams.map((t) => {
        const block = teamBlock(lineup, t.id, rules);
        const n = counts.get(t.id) ?? 0;
        const kit = teamColor(t.id);
        return (
          <li key={t.id}>
            <button
              disabled={block.blocked || n === 0}
              onClick={() => onPick(t.id)}
              className={[
                'tap flex w-full flex-col items-center gap-1 rounded-2xl px-2 py-3',
                'ring-1 ring-inset ring-gold/15 transition-transform duration-200 ease-brand',
                block.blocked || n === 0
                  ? 'cursor-not-allowed opacity-40 grayscale'
                  : 'active:scale-[0.97]',
              ].join(' ')}
              style={{ background: kit.primary }}
            >
              <span
                className="font-poster text-lg leading-none"
                style={{ color: kit.ink }}
              >
                {t.short}
              </span>
              <span className="text-[10px] font-bold" style={{ color: kit.ink, opacity: 0.75 }}>
                {block.blocked
                  ? tt('lineup.picker.taken')
                  : opponentShortByTeam?.[t.id]
                    ? tt('lineup.picker.vs', { opp: opponentShortByTeam[t.id] })
                    : tt('lineup.picker.nPlayers', { n })}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
