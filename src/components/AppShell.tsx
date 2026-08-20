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

export interface AppShellProps {
  items: NavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  header?: ReactNode;
  /** עמודה שמופיעה רק בדסקטופ (טבלת מחזור, כיסוי קבוצות) */
  aside?: ReactNode;
  children: ReactNode;
}

export function AppShell({ items, activeId, onSelect, header, aside, children }: AppShellProps) {
  return (
    <div
      dir="rtl"
      style={{ '--nav-h': `${NAV_HEIGHT_PX}px` } as CSSProperties}
      className="flex h-[100dvh] w-full overflow-hidden bg-night text-chalk"
    >
      <SideRail items={items} activeId={activeId} onSelect={onSelect} />

      <div className="flex min-w-0 flex-1 flex-col">
        {header}

        <div className="flex min-h-0 flex-1">
          <main
            className="min-w-0 flex-1 overflow-y-auto overscroll-contain
                       pb-[calc(var(--nav-h)+env(safe-area-inset-bottom))]
                       lg:pb-0"
          >
            {children}
          </main>

          {aside ? (
            <aside className="hidden w-[300px] shrink-0 overflow-y-auto border-chalk/10
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

export function AppHeader({
  title, subtitle, right,
}: { title: string; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <header
      className="flex shrink-0 items-center justify-between gap-3 border-b border-chalk/10
                 bg-night px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))]"
    >
      <div className="min-w-0">
        <h1 className="truncate font-display text-xl font-black leading-tight">{title}</h1>
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
