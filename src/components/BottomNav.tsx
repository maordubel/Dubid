/**
 * BottomNav.tsx — ניווט תחתון שלא מסתיר תוכן.
 *
 * הבעיה הקלאסית: nav ב-`fixed bottom-0` מכסה את סוף התוכן, והמשתמש
 * לא יכול להגיע לשורה האחרונה ברשימה. שלושה תיקונים, כולם כאן:
 *
 *   1. גובה הניווט חשוף כמשתנה CSS (--nav-h) ש-AppShell מוסיף
 *      כ-padding-bottom לאזור התוכן. אין ניחושים ואין מספרי קסם.
 *   2. env(safe-area-inset-bottom) נוסף לגובה — על אייפון עם סרגל
 *      הבית, בלעדיו הכפתורים נחתכים.
 *   3. אזור התוכן משתמש ב-100dvh ולא ב-100vh, אחרת סרגל הכתובות
 *      של ספארי בולע 60px בגלילה.
 *
 * RTL: הפריטים מסודרים בעזרת flex עם dir="rtl" ברמת המסמך —
 * הפריט הראשון במערך מופיע בימין. אין `left`/`right` בקוד.
 */
import type { CSSProperties, ReactNode } from 'react';

export interface NavItem {
  id: string;
  label: string;
  icon: ReactNode;
  badge?: number;
}

export interface NavProps {
  items: NavItem[];
  activeId: string;
  onSelect: (id: string) => void;
}

export const NAV_HEIGHT_PX = 64;

export function BottomNav({ items, activeId, onSelect }: NavProps) {
  return (
    <nav
      aria-label="ניווט ראשי"
      style={{ '--nav-h': `${NAV_HEIGHT_PX}px` } as CSSProperties}
      className="fixed inset-x-0 bottom-0 z-nav border-t border-chalk/10
                 bg-night-2/95 backdrop-blur
                 pb-[env(safe-area-inset-bottom)]
                 lg:hidden"
    >
      <ul className="flex h-[var(--nav-h)]">
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <li key={item.id} className="flex-1">
              <button
                type="button"
                onClick={() => onSelect(item.id)}
                aria-current={active ? 'page' : undefined}
                className={[
                  'tap relative flex h-full w-full flex-col items-center justify-center gap-0.5',
                  'text-[10px] font-bold transition-colors duration-200 ease-brand',
                  active ? 'text-toto' : 'text-chalk-dim active:text-chalk',
                ].join(' ')}
              >
                <span
                  className={[
                    'text-[20px] leading-none transition-transform duration-200 ease-brand',
                    active ? 'scale-110 drop-shadow-[0_0_10px_var(--toto)]' : '',
                  ].join(' ')}
                  aria-hidden
                >
                  {item.icon}
                </span>
                <span>{item.label}</span>

                {item.badge ? (
                  <span
                    dir="ltr"
                    className="absolute top-1.5 start-[calc(50%+10px)]
                               min-w-[18px] rounded-full bg-flare px-1 text-[10px]
                               font-bold leading-[18px] text-chalk"
                  >
                    {item.badge > 9 ? '9+' : item.badge}
                  </span>
                ) : null}

                {/* מחוון פעיל — קו כתום בקצה העליון, לא underline */}
                <span
                  aria-hidden
                  className={[
                    'absolute top-0 h-[3px] w-8 rounded-b-full bg-toto transition-opacity duration-200',
                    active ? 'opacity-100' : 'opacity-0',
                  ].join(' ')}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** אותם פריטים, פס אנכי — הגרסה לדסקטופ. */
export function SideRail({ items, activeId, onSelect }: NavProps) {
  return (
    <nav
      aria-label="ניווט ראשי"
      className="hidden w-[84px] shrink-0 flex-col items-center gap-1 border-chalk/10
                 bg-night-2 pt-4 border-e lg:flex"
    >
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            aria-current={active ? 'page' : undefined}
            className={[
              'tap flex w-[64px] flex-col items-center gap-1 rounded-2xl py-2.5',
              'text-[10px] font-bold transition-colors duration-200 ease-brand',
              active ? 'bg-toto/12 text-toto' : 'text-chalk-dim hover:bg-night-3 hover:text-chalk',
            ].join(' ')}
          >
            <span className="text-[20px] leading-none" aria-hidden>{item.icon}</span>
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
