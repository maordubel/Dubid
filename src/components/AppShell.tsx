/**
 * AppShell.tsx — המעטפת שהופכת את זה לאפליקציה ולא לאתר.
 *
 * ההבדל בפועל:
 *   · הדף עצמו לא נגלל. רק אזור התוכן נגלל (overflow-y-auto).
 *     ככה אין "קפיצת כותרת" ואין bounce של הדפדפן.
 *   · 100dvh ולא 100vh.
 *   · במובייל: ניווט תחתון צמוד. מעל lg: פס אנכי + עמודת צד.
 *     אותם קומפוננטות, פריסה אחרת — לא שני מימושים.
 *   · padding-bottom של התוכן מחושב מגובה הניווט + safe-area,
 *     ולכן הניווט לעולם לא מכסה את סוף התוכן.
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { BottomNav, SideRail, NAV_HEIGHT_PX, type NavItem } from './BottomNav.tsx';
import { LogoMark } from './Logo.tsx';
import { MISREGISTER } from '../lib/pressPalette.ts';

export interface AppShellProps {
  items: NavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  header?: ReactNode;
  /** עמודה שמופיעה רק בדסקטופ (טבלת מחזור, כיסוי קבוצות) */
  aside?: ReactNode;
  /**
   * ★ מסך שמנהל את הגובה בעצמו ולא נגלל.
   *
   * מסך בניית ההרכב חייב את זה: המגרש אמור למלא בדיוק את המקום
   * שנשאר ולהיראות במלואו. כשהאזור נגלל, המגרש נדחף מתחת לקפל
   * והמשתמש רואה חצי מגרש — בדיוק התלונה.
   */
  fill?: boolean;
  children: ReactNode;
}

export function AppShell({
  items, activeId, onSelect, header, aside, fill = false, children,
}: AppShellProps) {
  return (
    <div
      dir="rtl"
      style={{ '--nav-h': `${NAV_HEIGHT_PX}px` } as CSSProperties}
      className="tex-wood flex h-[100dvh] w-full overflow-hidden text-chalk"
    >
      <SideRail items={items} activeId={activeId} onSelect={onSelect} />

      <div className="flex min-w-0 flex-1 flex-col">
        {header}

        <div className="flex min-h-0 flex-1">
          <main
            className={[
              'min-w-0 flex-1 overscroll-contain',
              // ★ הריפוד התחתון זהה בשני המצבים — וזה מכוון.
              //
              //   הבאג: במצב `fill` הריפוד הוסר, כי "הילד מנהל גובה
              //   בעצמו". אבל הילד מודד `h-full` מול תיבת התוכן של
              //   `main`, והניווט הוא `fixed bottom-0` — הוא לא בזרימה
              //   ואף אחד לא משאיר לו מקום. התוצאה: כפתור "נעילת
              //   ההרכב" ישב **מתחת** לניווט, והמסך לא נגלל כדי
              //   להגיע אליו. אי אפשר היה לשלוח הרכב מהטלפון.
              //
              //   הריפוד גורע מגובה תיבת התוכן, ולכן `h-full` של
              //   הילד נעצר בדיוק מעל הניווט. אותה נוסחה בדיוק בשני
              //   הענפים — אין שני חישובי גובה שיכולים להיפרד.
              'pb-[calc(var(--nav-h)+env(safe-area-inset-bottom))] lg:pb-0',
              fill
                ? 'flex min-h-0 flex-col overflow-hidden'
                : 'overflow-y-auto',
            ].join(' ')}
          >
            {children}
          </main>

          {aside ? (
            <aside className="hidden w-[300px] shrink-0 overflow-y-auto border-gold/12
                              bg-night-2 p-4 border-s xl:block">
              {aside}
            </aside>
          ) : null}
        </div>
      </div>

      <BottomNav items={items} activeId={activeId} onSelect={onSelect} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* כותרת סטנדרטית                                                      */
/* ------------------------------------------------------------------ */

/**
 * ★ הסמל בכותרת — 30px, לא הלוגו המלא.
 *
 * הלוגו המלא הוא דיוקן + חתימה + כדור. בשורת כותרת בגובה 60px
 * שלושתם נדחסים לכתם. הסמל (הדיוקן בלבד) נשאר קריא, ומחזיק את
 * הנוכחות של המותג בכל מסך בלי לגזול מקום מהכותרת עצמה.
 *
 * הקו התחתון בזהב שקוף ולא באפור: זה הפרט שקושר את הכותרת לשאר
 * השפה. גבול אפור על עץ כהה נראה כמו קו שנשכח.
 */
export function AppHeader({
  title, subtitle, right,
}: { title: string; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <header
      className="flex shrink-0 items-center gap-3 border-b border-gold/15
                 bg-night/80 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur"
    >
      <LogoMark size={30} className="opacity-90" />
      <div className="min-w-0 flex-1">
        {/* ★ אי-התאמת לוחות הדפוס — אותו פרט בדיוק כמו בכותרות
            הלובי והדירוג. בלעדיו הכותרת של המסכים הפנימיים היא
            הסריפית היחידה במוצר שלא "הודפסה", וזה נקרא, גם אם
            אף אחד לא יודע להגיד למה. */}
        <h1
          className="truncate font-press text-xl font-black leading-tight text-chalk"
          style={{ textShadow: MISREGISTER }}
        >
          {title}
        </h1>
        {subtitle ? <div className="text-xs text-chalk-dim">{subtitle}</div> : null}
      </div>
      {right}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* דוגמת שימוש                                                         */
/* ------------------------------------------------------------------ */

export const DUBID_NAV: NavItem[] = [
  { id: 'lineup', label: 'ההרכב', icon: '◎' },
  { id: 'players', label: 'שחקנים', icon: '▦' },
  { id: 'league', label: 'הליגה', icon: '⚑' },
  { id: 'card', label: 'הכרטיס', icon: '◐' },
  { id: 'more', label: 'עוד', icon: '☰' },
];

export function DubidApp({ screens }: { screens: Record<string, ReactNode> }) {
  const [tab, setTab] = useState('lineup');
  return (
    <AppShell
      items={DUBID_NAV}
      activeId={tab}
      onSelect={setTab}
      header={
        <AppHeader
          title="מחזור 7"
          subtitle={
            <>
              נעילה בעוד{' '}
              <span dir="ltr" className="num text-flare">02:14:38</span>
            </>
          }
        />
      }
    >
      {screens[tab]}
    </AppShell>
  );
}
