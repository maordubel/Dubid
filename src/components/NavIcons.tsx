/**
 * components/NavIcons.tsx — אייקוני הניווט.
 *
 * ★ למה SVG ולא אמוג׳י או גליף
 *
 * הניווט השתמש ב-`⚑ ◎ ◆ ▦ ☰`. גליפים כאלה מרונדרים בפונט של
 * מערכת ההפעלה: משקל שונה בין אנדרואיד לאייפון, גובה בסיס שונה,
 * וחלקם פשוט חסרים בעברית ומוחלפים בריבוע. במסך שאמור להיראות
 * מוטבע בזהב זה הפרט שמסגיר שהכל מאולתר.
 *
 * כולם על רשת 24, קו 1.6, `currentColor` — כך הצבע מגיע מהמצב
 * (פעיל/לא פעיל) ולא מהאייקון.
 */
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function Svg({ children }: { children: React.ReactNode }) {
  return <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">{children}</svg>;
}

/** בית — שער כדורגל, לא בית מגורים. */
export function IconHome() {
  return (
    <Svg>
      <path d="M3 9.5 12 4l9 5.5" {...S} />
      <path d="M4.5 10.5v9h15v-9" {...S} />
      <path d="M8.5 19.5v-5h7v5" {...S} />
    </Svg>
  );
}

/** ההרכב — מגרש עם סידור. */
export function IconLineup() {
  return (
    <Svg>
      <rect x="3" y="3.5" width="18" height="17" rx="2.5" {...S} />
      <path d="M3 12h18" {...S} opacity=".55" />
      <circle cx="12" cy="12" r="2.7" {...S} opacity=".55" />
    </Svg>
  );
}

/** הזירה — משקפיים, המוטיב של המותג. */
export function IconArena() {
  return (
    <Svg>
      <path d="M2.5 8.5h8c.6 0 1 .5.95 1.1l-.35 2.9A2.8 2.8 0 0 1 8.3 15H7A2.8 2.8 0 0 1 4.2 12.6L3.6 9"
            {...S} />
      <path d="M21.5 8.5h-8c-.6 0-1 .5-.95 1.1l.35 2.9A2.8 2.8 0 0 0 15.7 15H17a2.8 2.8 0 0 0 2.8-2.4l.6-3.6"
            {...S} />
      <path d="M10.6 10.2c.9-.35 1.9-.35 2.8 0" {...S} />
    </Svg>
  );
}

/** דירוג — פודיום. */
export function IconRanking() {
  return (
    <Svg>
      <rect x="9.5" y="4" width="5" height="16" rx="1.2" {...S} />
      <rect x="2.5" y="9" width="5" height="11" rx="1.2" {...S} opacity=".65" />
      <rect x="16.5" y="12.5" width="5" height="7.5" rx="1.2" {...S} opacity=".45" />
    </Svg>
  );
}

/** חוקים — לוח הטקטיקה של דוביד. */
export function IconRules() {
  return (
    <Svg>
      <rect x="3.5" y="3" width="17" height="18" rx="2.2" {...S} />
      <path d="M7.5 8h9M7.5 12h9M7.5 16h5" {...S} />
    </Svg>
  );
}
