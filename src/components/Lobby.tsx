/**
 * components/Lobby.tsx — מסך הכניסה. מהדורת הלילה.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ למה הלובי הוא עמוד עיתון
 * ═══════════════════════════════════════════════════════════════
 *
 * כרטיס השיתוף ומסך בניית ההרכב כבר חיים בעולם אחד: נייר, דיו,
 * דשא מודפס בנקודות. הלובי היה העולם השני — כרטיסים מעוגלים,
 * גרדיאנטים, טיפוגרפיה גיאומטרית. כלומר **המסך הראשון שרואים
 * לא נראה כמו המוצר**.
 *
 * עכשיו הוא עמוד ראשון של עיתון ספורט: מאסטהד, מבזק, כותרת
 * ראשית, תצלום מוסרק, שתי עמודות, ושתי כתבות ממוסגרות.
 *
 * ★ ולמה כהה
 *
 * הלילה הוא הזהות של המוצר, ואין סיבה לוותר עליה. הפתרון הוא
 * היפוך של אותה מערכת: דיו שמנת על נייר כהה, קווים בזהב עמום,
 * והתצלום כנגטיב. `NIGHT_PRESS` ב-`lib/pressPalette.ts` הוא
 * המקור — אותו קובץ שממנו קוראים גם הכרטיס וגם המגרש.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ סדר הקומות, ולמה הוא כזה
 * ═══════════════════════════════════════════════════════════════
 *
 *   פוליו    →  מי אני · גיליון · כמה משתתפים
 *   מאסטהד   →  הלוגו והשם. המסך היחיד שבו יש להם מקום.
 *   כותרת    →  **הדדליין**. זה הדבר הדחוף, ולכן הוא הכותרת.
 *   תצלום    →  אווירה. הוא לא נושא מידע, והוא לא מתיימר.
 *   כתבות    →  שני מצבי המשחק. זו הפעולה.
 *   עמודות   →  התוצאות שלי · לוח המשחקים. זה ההקשר.
 *   מדורים   →  ליגות ודירוג.
 *   קרדיט    →  בית הדפוס, והערת המחזור.
 *
 * ★ הכתבות עלו מעל העמודות בכוונה: הפעולה קודמת להקשר. משתמש
 *   שנכנס כדי להגיש לא צריך לעבור דרך הטבלה שלו בדרך.
 */
import type { CSSProperties, ReactNode } from 'react';
import { AuthChip } from './AuthChip.tsx';
import { TeamTag } from './TeamTag.tsx';
import type { Identity } from '../lib/identity.ts';
import { OffsidesBanner } from './OffsidesBanner.tsx';
import { HouseBanner } from './HouseAds.tsx';
import { DubelCredit } from './DubelCredit.tsx';
import type { Promo } from '../lib/growth.ts';
import {
  GameweekStatus, STATUS_LABEL_HE, deadlineView, msUntilDeadline,
  isSubmissionOpen, type Gameweek,
} from '../lib/gameweek.ts';
import type { ModeId } from '../lib/events/bus.ts';
import { modeTheme } from '../lib/modeTheme.ts';
import { NIGHT_PRESS as NP, MISREGISTER } from '../lib/pressPalette.ts';
import { pressNote } from '../lib/pressNotes.ts';
import { text as content, hasText } from '../lib/content.ts';
import { ModeMark } from './ModeMark.tsx';

export interface LobbyMode {
  id: ModeId;
  title: string;
  tagline: string;
  /** מצב ההרכב של המשתמש במצב הזה. */
  state: 'empty' | 'draft' | 'submitted' | 'scored';
  /**
   * ★ הניקוד שמוצג עדיין יכול לזוז.
   *
   * ההבדל בין "45 נק׳" ל-"45 נק׳ · חי" הוא ההבדל בין מספר
   * שנראה סופי ומתברר כלא, לבין מספר שהמשתמש חוזר לבדוק.
   */
  live?: boolean;
  /** נקודות המחזור, אם כבר נוקד. */
  points?: number;
  /** מקום בדירוג, אם כבר נוקד. */
  rank?: number;
  filled: number;
  size: number;
}

/** משחק קרוב, כפי שהלובי צריך אותו. בלי תלות במבנה של `data/fixtures`. */
export interface LobbyFixture {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  homeShort: string;
  awayShort: string;
  dayLabel: string;
  timeLabel: string;
}

export interface LobbyProps {
  gameweek: Gameweek;
  /** שעון מסונכרן־שרת. מוזרק כדי שהמסך לא ימציא זמן משלו. */
  nowMs: number;
  modes: LobbyMode[];
  displayName?: string;
  entrants?: number;
  leagueCount?: number;
  myRank?: number;
  myPoints?: number;
  fixtures?: LobbyFixture[];
  onPlay: (mode: ModeId) => void;
  onLeagues: () => void;
  onLeaderboard: () => void;
  onAccount?: () => void;
  identity?: Identity | null;
  nudge?: ReactNode;
  promo?: Promo | null;
  gameweekNumber?: number;
  onDismissPromo?: () => void;
  onOpenPromo?: (promo: Promo) => void;
}

/* ================================================================== */

export function Lobby({
  gameweek, nowMs, modes, displayName, entrants, leagueCount,
  myRank, myPoints, fixtures = [],
  onPlay, onLeagues, onLeaderboard, onAccount, identity = null, nudge,
  promo, gameweekNumber = gameweek.number, onDismissPromo, onOpenPromo,
}: LobbyProps) {
  /**
   * ★★ הזמן מגיע מבחוץ, נקודה. ★★
   *
   * כאן ישב מונה פנימי: `now = nowMs + tick * 1000`. הוא היה
   * נכון בדיוק כל עוד `nowMs` לא זז — אבל `nowMs` הוא
   * `serverNow()` שנקרא בכל רינדור. אחרי עשרים דקות בלובי
   * `tick` הגיע ל-1200; ואז מישהו אחר הגיש, הגיע אירוע זמן
   * אמת, האפליקציה רינדרה מחדש, ו-`nowMs` קפץ ב-1200 שניות —
   * **על גבי** `tick` שכבר ספר אותן.
   *
   * התוצאה: השעון קפץ עשרים דקות קדימה, הגיע ל-00:00, וכרטיסי
   * המשחק הכריזו "נעול" בזמן שהשרת עדיין קיבל הגשות. שקר, ולא
   * חסימה — וזה גרוע יותר.
   */
  const remaining = msUntilDeadline(gameweek, nowMs);
  const open = isSubmissionOpen(gameweek, nowMs);
  const view = deadlineView(open ? remaining : 0);

  return (
    <div className="min-h-full" style={{ background: NP.paperDeep }}>
      <div className="relative mx-auto w-full max-w-lg overflow-hidden lg:max-w-2xl"
           style={pageSurface}>
        <PaperTexture />

        {/* ═══════════ פוליו עליון ═══════════ */}
        <div className="relative z-[2] flex items-center gap-2 px-3 pt-[calc(0.5rem+env(safe-area-inset-top))]">
          <AuthChip
            identity={identity ?? (displayName
              ? ({ id: '', displayName, isGuest: true, username: null, avatar: null,
                   referralCode: null, offsidesUserId: null, provider: null,
                   online: false } as Identity)
              : null)}
            onOpen={() => onAccount?.()}
          />
          <span className="flex-1" />
          <span className="press-folio">
            שנה ב׳ · גיליון <span className="num">{gameweekNumber}</span>
          </span>
          {entrants ? (
            <span className="press-folio">
              <b className="num" style={{ color: NP.ink }}>{entrants}</b> משתתפים
            </span>
          ) : null}
        </div>

        <Rule weight="top" />

        {/* ═══════════ מאסטהד ═══════════ */}
        {/*
          ★ הלוגו גדול כאן ולא בשום מקום אחר.
          זה המסך היחיד שבו למשתמש אין משימה פתוחה. בכל שאר
          המסכים יש הרכב לבנות או טבלה לקרוא, ושם הסמל יורד
          ל-26px בכותרת. גודל הוא החלטה לפי מסך, לא קבוע מותג.
        */}
        <div className="relative z-[2] px-3 pt-1.5 text-center">
          <img
            src="/brand/dubid-logo-cream@360.png"
            alt=""
            width={90}
            height={90}
            className="mx-auto block w-[86px]"
            style={{ filter: 'drop-shadow(0 0 22px rgba(216,178,92,.22))' }}
          />
          <h1
            className="font-press text-[44px] font-black leading-[0.94] tracking-[-.02em]"
            style={{ color: NP.ink, textShadow: MISREGISTER }}
          >
            דוביד
          </h1>
          <p className="press-spaced pt-[3px] text-[10.5px]" style={{ color: NP.gold }}>
            {spaced('מהדורת המחזור')}
          </p>
        </div>

        <Rule weight="bottom" />

        {/* ★ הודעת מערכת — נערכת מלוח הניהול, בלי פריסה.
            ריקה = לא מוצגת בכלל. */}
        {hasText('announce.text') && (
          <div role="status" className="relative z-[2] px-3 pt-2.5">
            <p
              className="border px-3 py-2 text-[12.5px] leading-snug"
              style={announceStyle(content('announce.tone'))}
            >
              {content('announce.text')}
            </p>
          </div>
        )}

        {/* ═══════════ הכותרת הראשית — הדדליין ═══════════ */}
        <Headline
          view={view}
          statusLabel={STATUS_LABEL_HE[gameweek.status]}
          published={gameweek.status === GameweekStatus.Published}
          kicker={content('lobby.hero.kicker')}
        />

        <PressPhoto gameweekNumber={gameweekNumber} />

        <Ornament />

        {/* ═══════════ הכתבות — מצבי המשחק ═══════════ */}
        <section className="relative z-[2] px-3" aria-label="בחירת מצב משחק">
          {modes.map((m, i) => (
            <div key={m.id} className={i > 0 ? 'mt-2.5' : ''}>
              <ModeArticle mode={m} open={open} onPlay={() => onPlay(m.id)} />
            </div>
          ))}
        </section>

        {/* ★ ההצעה להירשם — אחרי שראה מה יש לו, לפני שהוא הולך. */}
        {nudge && <div className="relative z-[2] px-3 pt-2.5">{nudge}</div>}

        {/* ═══════════ שתי עמודות ═══════════ */}
        <Rule weight="hair" className="mt-3" />
        <div className="relative z-[2] grid grid-cols-[1fr_1px_1fr]">
          <Column title="התוצאות שלי">
            <LeaderRow label="מחזור" value={String(gameweekNumber)} />
            <LeaderRow label="נקודות" value={myPoints !== undefined ? String(myPoints) : '—'} />
            <LeaderRow label="מקום" value={myRank ? String(myRank) : '—'} />
            <LeaderRow label="ליגות" value={leagueCount ? String(leagueCount) : '—'} />
          </Column>
          <span aria-hidden="true" style={{ background: NP.rule }} />
          <Column title="לוח המשחקים">
            {fixtures.length === 0 ? (
              <p className="px-2 pt-1 text-[11.5px]" style={{ color: NP.inkFaint }}>
                הלוח טרם פורסם.
              </p>
            ) : fixtures.slice(0, 4).map((f) => (
              <li key={f.id} className="flex items-baseline gap-1.5 px-2 py-[3px] text-[11.5px]">
                <span className="flex min-w-0 shrink items-center gap-1">
                  <TeamTag teamId={f.homeTeamId} short={f.homeShort} size="xs" />
                  <span aria-hidden="true" style={{ color: NP.inkFaint }}>—</span>
                  <TeamTag teamId={f.awayTeamId} short={f.awayShort} size="xs" />
                </span>
                <span className="press-lead" aria-hidden="true" />
                <span className="num shrink-0 text-[11px] font-bold" style={{ color: NP.goldLight }}>
                  {f.timeLabel}
                </span>
              </li>
            ))}
          </Column>
        </div>
        <Rule weight="hair" />

        {/* ═══════════ מדורים ═══════════ */}
        <div className="relative z-[2] grid grid-cols-2 gap-2.5 px-3 pt-3">
          <SectionTile label="ליגות פרטיות"
                       hint={leagueCount ? `${leagueCount} ליגות` : 'שחקו מול חברים'}
                       onClick={onLeagues} icon={<TileShades />} />
          <SectionTile label="הדירוג" hint="מי מוביל"
                       onClick={onLeaderboard} icon={<TilePodium />} />
        </div>

        {/* ═══════════ גם שלנו ═══════════
            ★ הרצועה יושבת **אחרי** המדורים ולפני בית הדפוס, ולא
            בין שתי תיבות המשחק. הלובי הוא מסך של החלטה אחת —
            איזה משחק לפתוח — וכל דבר שנכנס באמצע ההחלטה הזו
            מוריד את שיעור ההתחלה. אחרי שהמשתמש כבר סרק את מה
            שהוא בא בשבילו, רצועה אחת היא סקרנות ולא הפרעה. */}
        <div className="relative z-[2] px-3 pt-3">
          <HouseBanner placement="lobby" gameweekNumber={gameweekNumber} />
        </div>

        {promo && (
          <div className="relative z-[2] px-3 pt-3">
            <OffsidesBanner
              promo={promo}
              placement="lobby"
              gameweekNumber={gameweekNumber}
              onDismiss={onDismissPromo}
              onOpen={onOpenPromo}
            />
          </div>
        )}

        {/* ═══════════ בית הדפוס ═══════════ */}
        <Rule weight="top" className="mt-4" />
        <footer className="relative z-[2] px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3 text-center">
          {/* ★ הקרדיט **הוא** שורת בית הדפוס.
              קודם היו כאן שתי שורות שאומרות את אותו דבר: "הובא
              לדפוס ע״י DubelTeam" ומתחתיה "נבנה על ידי Dubel
              Team". שתי חתימות של אותה חברה בתחתית אותו עמוד. */}
          <DubelCredit />
          <p className="pt-2 text-[9.5px] italic leading-[1.7]" style={{ color: NP.inkFaint }}>
            {/* ★ הערת המחזור. אותה הערה לכולם — ראו `lib/pressNotes.ts`. */}
            {pressNote(gameweekNumber)}
          </p>
          <div className="flex items-center justify-between pt-2.5">
            <span className="press-folio">DUBID.DUBELTEAM.COM</span>
            <span className="press-folio">עמוד <span className="num">1</span></span>
          </div>
        </footer>
      </div>
    </div>
  );
}

/* ================================================================== */
/* הנייר                                                               */
/* ================================================================== */

const pageSurface: CSSProperties = {
  background: NP.paper,
  backgroundImage: [
    'radial-gradient(150px 110px at 12% 7%, rgba(216,178,92,.10), transparent 70%)',
    'radial-gradient(180px 130px at 90% 32%, rgba(216,178,92,.075), transparent 72%)',
    'radial-gradient(130px 100px at 28% 76%, rgba(196,52,47,.055), transparent 70%)',
  ].join(','),
};

/**
 * ★ שלוש שכבות שהופכות משטח כהה לנייר כהה.
 *
 *   גרעיניות — נקודות דיו זעירות. בלעדיה המשטח נקרא כמו מסך.
 *   כתמים    — ארבעה כתמי דיו לא סדירים.
 *   קיפול    — קו אור לאורך המרכז, כמו עמוד שהיה מקופל.
 *
 * הכול `pointer-events-none` ו-`aria-hidden`: זו אווירה, ואסור
 * לה להיכנס לעץ הנגישות או לחסום לחיצה.
 */
function PaperTexture() {
  return (
    <>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[1]"
        style={{
          backgroundImage: [
            'radial-gradient(rgba(237,228,206,.10) .55px, transparent .8px)',
            'radial-gradient(rgba(237,228,206,.05) .5px, transparent .7px)',
            'radial-gradient(2.6px 2.2px at 24% 17%, rgba(216,178,92,.10), transparent 100%)',
            'radial-gradient(3px 2.4px at 73% 29%, rgba(216,178,92,.08), transparent 100%)',
            'radial-gradient(2.4px 2px at 38% 61%, rgba(196,52,47,.09), transparent 100%)',
            'radial-gradient(3.2px 2.6px at 82% 78%, rgba(216,178,92,.08), transparent 100%)',
          ].join(','),
          backgroundSize: '5px 5px, 11px 11px, 100% 100%, 100% 100%, 100% 100%, 100% 100%',
          backgroundPosition: '0 0, 3px 4px, 0 0, 0 0, 0 0, 0 0',
        }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[1]"
        style={{
          background:
            'linear-gradient(90deg,transparent calc(50% - 10px),rgba(0,0,0,.42) calc(50% - 3px),' +
            'rgba(237,228,206,.055) 50%,rgba(0,0,0,.42) calc(50% + 3px),transparent calc(50% + 10px))',
        }}
      />
    </>
  );
}

/**
 * קווי העימוד.
 *
 * ★ זהב עמום ולא לבן: קו לבן על נייר כהה חותך את הדף לשניים
 *   ומושך את העין יותר מהכותרת שהוא אמור להפריד.
 */
function Rule({ weight, className = '' }: { weight: 'top' | 'bottom' | 'hair'; className?: string }) {
  const style: CSSProperties =
    weight === 'hair'
      ? { borderTop: `1px solid ${NP.rule}` }
      : weight === 'top'
        ? { borderTop: `3px solid ${NP.ruleStrong}`, borderBottom: `1px solid ${NP.rule}`, height: 4 }
        : { borderTop: `1px solid ${NP.rule}`, borderBottom: `3px solid ${NP.ruleStrong}`, height: 4 };
  return <div aria-hidden="true" className={`relative z-[2] mx-3 ${className}`} style={style} />;
}

function Ornament() {
  return (
    <div aria-hidden="true" className="relative z-[2] py-2 text-center text-[11px]"
         style={{ color: NP.goldDeep, letterSpacing: '8px' }}>
      ✦ ✦ ✦
    </div>
  );
}

/* ================================================================== */
/* הכותרת הראשית — הדדליין                                             */
/* ================================================================== */

/**
 * ★★ למה הדדליין הוא הכותרת הראשית ★★
 *
 * בעמוד ראשון של עיתון, הכותרת היא הדבר שדחוף היום. בלובי של
 * דוביד יש בדיוק דבר אחד כזה: **כמה זמן נשאר להגיש**. הנקודות
 * שלי הן היסטוריה, לוח המשחקים הוא רקע — רק השעון דורש פעולה.
 *
 * ★ והשעון רץ רק ביממה האחרונה.
 *
 * `72:14:07` כשנשארו שלושה ימים הוא מספר שאיש לא מתרגם לימים
 * בראש, והשניות שרצות הן רעש. גרוע מזה: שעון שרץ תמיד מפסיק
 * להיות סימן לדחיפות, ואז ביום האחרון הוא נראה בדיוק כמו תמיד.
 * ההחלטה עצמה יושבת ב-`deadlineView` ונבדקת שם.
 */
function Headline({
  view, statusLabel, published, kicker,
}: {
  view: ReturnType<typeof deadlineView>;
  statusLabel: string;
  published: boolean;
  kicker: string;
}) {
  const urgent = view.mode === 'urgent';
  const closed = view.mode === 'closed';

  return (
    <div className="relative z-[2] px-4 pt-2.5 text-center">
      <span
        className="inline-block px-2.5 py-[2px] text-[11px] font-bold tracking-[1.5px]"
        style={{
          background: urgent || closed ? NP.red : NP.red,
          color: '#fff',
          transform: 'rotate(-1.2deg)',
        }}
      >
        {closed ? statusLabel : view.flash}
      </span>

      {kicker && (
        <p className="pt-1.5 text-[11px] font-bold tracking-[3px]" style={{ color: NP.gold }}>
          {kicker}
        </p>
      )}

      {view.ticking ? (
        <>
          <h2 className="font-press pt-1.5 text-[21px] font-black leading-[1.02]"
              style={{ color: NP.ink, textShadow: MISREGISTER }}>
            {urgent ? 'ננעל בעוד' : 'ההרכבים ננעלים בעוד'}
          </h2>
          {/* המספר לחוד ובכיוון שלו. עירוב עברית בתוך מספר LTR
              הופך "02:12:38" ל-"402:12:38 ד" ברינדור. */}
          <div
            dir="ltr"
            className="num pt-[3px] leading-none"
            style={{
              fontSize: 44,
              letterSpacing: 1,
              color: urgent ? NP.redLight : NP.goldLight,
              textShadow: urgent
                ? '0 0 20px rgba(224,87,79,.42)'
                : '0 0 18px rgba(240,214,147,.32)',
            }}
          >
            {view.value}
          </div>
        </>
      ) : (
        <h2 className="font-press pt-1.5 text-[25px] font-black leading-[1.05]"
            style={{ color: NP.ink, textShadow: MISREGISTER }}>
          {closed
            ? (published ? 'התוצאות פורסמו' : 'ההרכבים נעולים')
            : `ההרכבים ננעלים ${view.value}`}
        </h2>
      )}

      <p className="pt-1 text-[12.5px] leading-snug" style={{ color: NP.inkDim }}>
        {view.note}
      </p>
    </div>
  );
}

/* ================================================================== */
/* התצלום המוסרק                                                       */
/* ================================================================== */

/**
 * ★ למה תצלום שלא נושא שום מידע הוא בכל זאת נכון.
 *
 * עמוד ספורט בלי תמונה נראה כמו טופס. התמונה כאן לא אומרת
 * כלום — והיא לא מתיימרת: הכיתוב מתחתיה כתוב באות נטויה ואומר
 * "צילום: ארכיון", בדיוק כמו תצלום ארכיון בעיתון אמיתי.
 *
 * ★ ולמה זה SVG ולא קובץ.
 *
 * אלה בדיוק אותן דמויות שמצוירות בכרטיס השיתוף ועל המגרש: קו
 * מתאר, ראש, חולצה עם שרוולים. תמונה אמיתית הייתה שוברת את
 * החיבור בין שלושת המסכים — ושוקלת 80kb במסך הראשון.
 *
 * ★ ובגרסה הכהה היא **נגטיב**: נקודות ההלפטון בהירות על כהה.
 *   אותו מסך דפוס, הפוך.
 */
function PressPhoto({ gameweekNumber }: { gameweekNumber: number }) {
  return (
    <figure className="relative z-[2] px-3 pt-2.5">
      <div
        className="relative h-[88px] overflow-hidden"
        style={{ border: `1px solid ${NP.rule}`, background: NP.grassDark }}
      >
        <span
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              `linear-gradient(180deg,${NP.grass} 0%,#333A2C 40%,#252E20 41%,${NP.grassDark} 100%)`,
          }}
        />
        <PitchScene />
        <span
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            mixBlendMode: 'overlay',
            opacity: 0.55,
            backgroundImage:
              'radial-gradient(rgba(237,228,206,.9) 1.1px,transparent 1.3px),' +
              'radial-gradient(rgba(237,228,206,.9) 1.1px,transparent 1.3px)',
            backgroundSize: '4px 4px, 4px 4px',
            backgroundPosition: '0 0, 2px 2px',
          }}
        />
        <span
          className="absolute bottom-[5px] px-[7px] py-[1px] text-[9.5px] font-bold"
          style={{ insetInlineStart: 6, background: NP.gold, color: NP.paper, letterSpacing: 1 }}
        >
          ליגת העל · מחזור <span className="num">{gameweekNumber}</span>
        </span>
      </div>
      <figcaption className="px-1 pt-[3px] text-[9.5px] italic" style={{ color: NP.inkFaint }}>
        מי שמכיר את הליגה — יודע מה קורה בשבת. <b>צילום: ארכיון</b>
      </figcaption>
    </figure>
  );
}

function PitchScene() {
  return (
    <svg viewBox="0 0 320 104" preserveAspectRatio="xMidYMax slice"
         className="absolute inset-0 h-full w-full" aria-hidden="true">
      <g stroke={NP.ink} strokeLinejoin="round" strokeLinecap="round">
        <g stroke="rgba(237,228,206,.55)" strokeWidth="1.5" fill="none">
          <path d="M0 86 H320" /><path d="M232 104 V70 H320" /><path d="M264 104 V84 H320" />
          <circle cx="86" cy="104" r="26" />
        </g>
        <g>
          <path d="M14 78 L26 50 L74 50 L82 78 Z" fill="rgba(237,228,206,.10)" />
          <g stroke="rgba(237,228,206,.35)" strokeWidth=".7">
            <path d="M26 50 L28 78 M38 50 L38 78 M50 50 L50 78 M62 50 L62 78 M74 50 L70 78" />
            <path d="M20 64 H78 M23 57 H76" />
          </g>
          <path d="M14 78 L26 50 L74 50 L82 78" fill="none" strokeWidth="2.4" />
        </g>
        <Figure x={126} y={80} s={1.35} shirt="#C8BFA8" striped />
        <Figure x={196} y={86} s={1.5} shirt="#6E6A5C" />
        <Figure x={268} y={78} s={1.15} shirt="#A9A08C" />
        <g transform="translate(160,94)">
          <circle r="6.5" fill={NP.ink} strokeWidth="1.6" />
          <path d="M0 -6.5 L4 -2 L2 3.5 L-2 3.5 L-4 -2 Z" fill="#141210" />
        </g>
      </g>
    </svg>
  );
}

function Figure({
  x, y, s, shirt, striped = false,
}: { x: number; y: number; s: number; shirt: string; striped?: boolean }) {
  return (
    <g transform={`translate(${x},${y}) scale(${s})`}>
      <g fill="#4A4438" strokeWidth="1.5">
        <rect x="-9.5" y="6" width="7" height="17" rx="2.6" />
        <rect x="2.5" y="6" width="7" height="17" rx="2.6" />
      </g>
      <path d="M-14 23 h10 v4 h-10 z M2 23 h10 v4 h-10 z" fill={NP.ink} />
      <rect x="-11" y="-3" width="22" height="11" rx="2.6" fill="#1A1712" strokeWidth="1.5" />
      <g fill="#4A4438" strokeWidth="1.5">
        <rect x="-18.5" y="-18" width="6" height="16" rx="2.6" />
        <rect x="12.5" y="-18" width="6" height="16" rx="2.6" />
      </g>
      <path d="M-13 -21 h26 l2 18 h-30 z" fill={shirt} strokeWidth="1.6" />
      {striped && (
        <path d="M-9 -21 v18 M-3 -21 v18 M3 -21 v18 M9 -21 v18"
              stroke="#1A1712" strokeWidth="2.4" fill="none" />
      )}
      <circle cx="0" cy="-28" r="7" fill="#4A4438" strokeWidth="1.5" />
      <path d="M-7 -29.5 a7 7 0 0 1 14 0 z" fill="#17140F" />
    </g>
  );
}

/* ================================================================== */
/* הכתבה — מצב משחק                                                    */
/* ================================================================== */

/**
 * ★★ כאן נולדת הזהות הנפרדת בין המצבים ★★
 *
 * שני מצבים שנראים אותו דבר **נחווים** אותו דבר, ואז אין סיבה
 * לשחק בשניהם. מה שמפריד, לפי סדר החשיבות מבחינת העין:
 *
 *   1. **פס הכותרת.** בצבע המצב, מלא מקצה לקצה. נקלט ראשון.
 *   2. **הדיאגרמה ברקע.** מגרש חמישה מול מגרש מלא, עם מספר
 *      הנקודות הנכון בכל אחד. היא אומרת "חמישה על מגרש קטן"
 *      בלי מילה אחת של הסבר.
 *   3. **הספרה המעומעמת.** `5×5` / `11×11` בגודל ענק ובאטימות
 *      נמוכה, כמו מספר עמוד ענק בעיתון.
 *   4. **שם הקוד.** "הרחוב" מול "הליגה".
 *
 * ★ מה **לא** משתנה: הטיפוגרפיה, המרווחים והגובה. שני מצבים
 *   של אותו מוצר, לא שני מוצרים.
 *
 * ★ ואין כאן שום תמונה. הדיאגרמות הן SVG של כמה מאות בתים —
 *   המסך הראשון של המוצר לא מחכה לרשת.
 */
function ModeArticle({
  mode, open, onPlay,
}: { mode: LobbyMode; open: boolean; onPlay: () => void }) {
  const t = modeTheme(mode.id);
  const done = mode.state === 'submitted' || mode.state === 'scored';
  const five = mode.id === 'five';

  return (
    <button
      onClick={onPlay}
      aria-label={`${mode.title} — ${mode.tagline}`}
      className="tap relative block w-full overflow-hidden text-start
                 transition-transform duration-200 ease-brand active:scale-[.995]"
      style={{ border: `3px double ${t.accent}99`, background: NP.card, color: t.accent }}
    >
      {/* פס הכותרת */}
      <span
        className="block px-2 py-[3px] text-center text-[11px] font-bold"
        style={{ background: t.accent, color: NP.paper, letterSpacing: 2 }}
      >
        {spaced(mode.title)} · {spaced(t.codeName)}
      </span>

      {/* ---- אפקט הרקע ---- */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[.22]">
        <svg viewBox="0 0 200 60" preserveAspectRatio="none" className="h-full w-full"
             fill="none" stroke="currentColor" strokeWidth="1.2">
          <rect x="4" y="4" width="192" height="52" />
          <path d="M100 4 V56" />
          <circle cx="100" cy="30" r="11" />
          {five ? (
            <>
              <path d="M4 18 H22 V42 H4" /><path d="M196 18 H178 V42 H196" />
              <g fill="currentColor" stroke="none">
                <circle cx="26" cy="30" r="3.4" /><circle cx="66" cy="16" r="3.4" />
                <circle cx="66" cy="44" r="3.4" /><circle cx="128" cy="30" r="3.4" />
                <circle cx="168" cy="30" r="3.4" />
              </g>
            </>
          ) : (
            <>
              <path d="M4 12 H30 V48 H4" /><path d="M196 12 H170 V48 H196" />
              <path d="M4 21 H15 V39 H4" /><path d="M196 21 H185 V39 H196" />
              <g fill="currentColor" stroke="none">
                <circle cx="14" cy="30" r="3" />
                <circle cx="46" cy="12" r="3" /><circle cx="46" cy="26" r="3" />
                <circle cx="46" cy="40" r="3" /><circle cx="46" cy="52" r="3" />
                <circle cx="86" cy="16" r="3" /><circle cx="86" cy="30" r="3" />
                <circle cx="86" cy="44" r="3" />
                <circle cx="140" cy="14" r="3" /><circle cx="140" cy="30" r="3" />
                <circle cx="140" cy="46" r="3" />
              </g>
            </>
          )}
        </svg>
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[.16]"
        style={{
          backgroundImage: 'radial-gradient(currentColor .9px,transparent 1.1px)',
          backgroundSize: '6px 6px',
        }}
      />
      <span
        aria-hidden="true"
        className="num pointer-events-none absolute -bottom-2 select-none leading-none opacity-[.16]"
        style={{ insetInlineStart: 8, fontSize: 54, letterSpacing: -2 }}
      >
        {five ? '5×5' : '11×11'}
      </span>

      {/* ---- גוף הכתבה ---- */}
      <span className="relative z-[1] block px-2.5 py-2">
        <span className="flex items-start gap-2">
          <ModeMark mode={mode.id} size={22} weight={2.8} />
          <span className="min-w-0 flex-1 text-[12.5px] leading-snug" style={{ color: NP.inkDim }}>
            {content(`mode.${mode.id}.tagline`) || mode.tagline}
          </span>
        </span>

        <span aria-hidden="true" className="mt-2 block"
              style={{ borderTop: `1px dotted ${NP.rule}` }} />

        <span className="mt-1.5 flex items-center justify-between gap-2">
          <span className="text-[12px] font-bold" style={{ color: t.accentLight }}>
            {statusLine(mode, open)}
          </span>
          <span
            className="font-press shrink-0 px-4 py-1 text-[13.5px] font-bold"
            style={{ background: t.accent, color: NP.paper }}
          >
            {/* ★ "שחק עכשיו" ולא "להמשיך".
                "להמשיך" הוא ניווט; "שחק עכשיו" אומר שיש כאן
                משחק. זה המסך הראשון, ולרוב האנשים שמגיעים אליו
                עדיין לא ברור מה בדיוק קורה כאן. */}
            {done ? 'לצפייה ›' : open ? 'שחק עכשיו ›' : 'נעול'}
          </span>
        </span>
      </span>
    </button>
  );
}

/** שורת המצב. קצרה בכוונה — היא יושבת ליד כפתור, לא לבד. */
function statusLine(mode: LobbyMode, open: boolean): string {
  if (mode.state === 'scored' && mode.points !== undefined) {
    const tail = mode.live ? ' · חי' : '';
    return mode.rank
      ? `הוגש · ${mode.points} נק׳ · מקום ${mode.rank}${tail}`
      : `הוגש · ${mode.points} נק׳${tail}`;
  }
  if (mode.state === 'submitted') return 'ההרכב נעול';
  if (!open) return 'ההגשות סגורות';
  if (mode.state === 'draft') return `בטיוטה · ${mode.filled}/${mode.size}`;
  return 'טרם התחלת';
}

/* ================================================================== */
/* עמודות וטבלאות                                                      */
/* ================================================================== */

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="px-2 py-2">
      <h3 className="text-center text-[11px] font-bold tracking-[3px]" style={{ color: NP.gold }}>
        {title}
      </h3>
      <ul className="pt-[3px]">{children}</ul>
    </div>
  );
}

/**
 * ★ שורה עם מובילי נקודות.
 *
 * זו הצורה שבה עיתון מציג "תווית · ערך" מאז ומתמיד, והיא גם
 * פשוט קריאה יותר מרווח ריק: העין נוסעת על הנקודות במקום
 * לחפש את הערך בצד השני.
 *
 * ★ '—' ולא אפס. "0 נקודות" ו"עוד אין תוצאות" הם שני דברים
 *   שונים, ומשתמש שרואה אפס אחרי שהגיש חושב שמשהו נשבר.
 */
function LeaderRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-baseline gap-1.5 px-2 py-[3px] text-[12.5px]">
      <span className="shrink-0" style={{ color: NP.inkDim }}>{label}</span>
      <span className="press-lead" aria-hidden="true" />
      <span className="num shrink-0 font-bold" style={{ color: NP.goldLight }}>{value}</span>
    </li>
  );
}

function SectionTile({
  label, hint, icon, onClick,
}: { label: string; hint: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="tap flex flex-col items-start gap-0.5 px-3 py-2.5 text-start
                 transition-colors duration-200 ease-brand"
      style={{ border: `1px solid ${NP.rule}`, background: NP.card }}
    >
      <span aria-hidden style={{ color: NP.gold }}>{icon}</span>
      <span className="font-press mt-1 text-[14px] font-bold" style={{ color: NP.ink }}>{label}</span>
      <span className="text-[11px]" style={{ color: NP.inkFaint }}>{hint}</span>
    </button>
  );
}

/* ================================================================== */

/** אותיות מרווחות. `letter-spacing` היה מרווח גם אחרי האות האחרונה. */
function spaced(s: string): string {
  return s.split('').join(' ');
}

function announceStyle(tone: string): CSSProperties {
  if (tone === 'alert') return { borderColor: '#C4342F', background: 'rgba(196,52,47,.12)', color: NP.redLight };
  if (tone === 'warn') return { borderColor: '#D8B25C', background: 'rgba(216,178,92,.10)', color: NP.goldLight };
  return { borderColor: NP.rule, background: NP.card, color: NP.inkDim };
}

function TileShades() {
  return (
    <svg viewBox="0 0 28 12" width="26" height="12" aria-hidden="true">
      <path d="M1 2.5h10.2c.6 0 1 .5.9 1.1l-.5 4c-.2 1.4-1.4 2.4-2.8 2.4H6.4c-1.5 0-2.7-1.1-2.9-2.6L3 4"
            fill="currentColor" opacity=".9" />
      <path d="M27 2.5H16.8c-.6 0-1 .5-.9 1.1l.5 4c.2 1.4 1.4 2.4 2.8 2.4h2.4c1.5 0 2.7-1.1 2.9-2.6l.5-3.4"
            fill="currentColor" opacity=".9" />
      <path d="M12 4.2c1.3-.5 2.7-.5 4 0" fill="none" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

function TilePodium() {
  return (
    <svg viewBox="0 0 28 20" width="26" height="19" aria-hidden="true">
      <rect x="10" y="2" width="8" height="18" rx="1.5" fill="currentColor" />
      <rect x="1" y="8" width="8" height="12" rx="1.5" fill="currentColor" opacity=".6" />
      <rect x="19" y="12" width="8" height="8" rx="1.5" fill="currentColor" opacity=".4" />
    </svg>
  );
}
