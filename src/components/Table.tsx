/**
 * components/Table.tsx — טבלאות.
 *
 * ★ הבעיה שזה פותר
 *
 * טבלה עם 6 עמודות היא מצוינת ב-1280px ובלתי שמישה ב-390px.
 * הפתרון הרגיל — גלילה אופקית — הוא בדיוק מה שהברִיף אוסר
 * ("מובייל תחילה", "מינימום גלילה מיותרת").
 *
 * לכן: **אותו קומפוננט, שתי פריסות.**
 *   · מובייל  — כל שורה היא כרטיס; רק עמודות `primary` נראות.
 *   · דסקטופ  — טבלה אמיתית עם כותרות דביקות.
 *
 * אין כאן שני מימושים ואין `isMobile` ב-JS. הפריסה נבחרת ב-CSS,
 * ולכן היא נכונה גם בסיבוב מסך וגם בחלון שמשנים לו גודל.
 */
import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  /** כותרת. ריק = עמודה בלי כותרת (למשל אווטאר/חולצה). */
  header: ReactNode;
  render: (row: T, index: number) => ReactNode;
  /** נראית גם במובייל. עמודה שאינה primary מוסתרת שם. */
  primary?: boolean;
  /** מספרים: יישור והצמדת רוחב. */
  numeric?: boolean;
  /** רוחב קבוע בדסקטופ, למשל '3rem'. */
  width?: string;
  align?: 'start' | 'center' | 'end';
}

export interface TableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  /** מדגיש שורה — למשל ההגשה של המשתמש עצמו. */
  highlight?: (row: T) => boolean;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  caption?: string;
}

export function Table<T>({
  columns, rows, rowKey, highlight, onRowClick, empty, caption,
}: TableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-chalk/10 bg-night-2 px-4 py-10 text-center
                      text-sm text-chalk-dim">
        {empty ?? 'אין נתונים להצגה.'}
      </div>
    );
  }

  const mobileCols = columns.filter((c) => c.primary !== false);

  return (
    <div className="overflow-hidden rounded-2xl border border-chalk/10 bg-night-2">
      {caption ? (
        <div className="border-b border-chalk/10 px-4 py-2.5 text-[11px] font-black
                        uppercase tracking-wide text-chalk-dim">
          {caption}
        </div>
      ) : null}

      {/* ---------- דסקטופ ---------- */}
      <table className="hidden w-full border-collapse text-sm md:table">
        <thead>
          <tr className="border-b border-chalk/10 bg-night-3/60">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                style={c.width ? { width: c.width } : undefined}
                className={[
                  'px-3 py-2.5 text-[11px] font-black uppercase tracking-wide text-chalk-dim',
                  c.numeric || c.align === 'end' ? 'text-end'
                    : c.align === 'center' ? 'text-center' : 'text-start',
                ].join(' ')}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={[
                'border-b border-chalk/5 last:border-0 transition-colors duration-150 ease-brand',
                highlight?.(row) ? 'bg-toto/10' : 'hover:bg-night-3/50',
                onRowClick ? 'cursor-pointer' : '',
              ].join(' ')}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={[
                    'px-3 py-2.5 align-middle',
                    c.numeric ? 'num text-end tabular-nums'
                      : c.align === 'center' ? 'text-center'
                      : c.align === 'end' ? 'text-end' : 'text-start',
                  ].join(' ')}
                >
                  {c.render(row, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* ---------- מובייל ---------- */}
      <ul className="divide-y divide-chalk/5 md:hidden">
        {rows.map((row, i) => (
          <li
            key={rowKey(row, i)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={[
              'flex items-center gap-3 px-3 py-3',
              highlight?.(row) ? 'bg-toto/10' : '',
              onRowClick ? 'tap active:bg-night-3' : '',
            ].join(' ')}
          >
            {mobileCols.map((c) => (
              <div
                key={c.key}
                className={[
                  c.numeric ? 'num shrink-0 tabular-nums text-end' : 'min-w-0',
                  c.key === mobileCols.find((m) => !m.numeric && !m.width)?.key ? 'flex-1' : '',
                ].join(' ')}
              >
                {c.render(row, i)}
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
