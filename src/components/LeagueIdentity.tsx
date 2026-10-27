/**
 * components/LeagueIdentity.tsx — הזהות של כל ליגה: דגל מצויר וצבע מבטא.
 *
 * ★ כל ליגה היא עולם משחק נפרד. אותו דגל ואותו צבע מופיעים בשער הליגות,
 *   במאסטהד של מרכז הליגה ובכרטיסים — כך שמשתמש יודע תמיד באיזו ליגה הוא,
 *   בלי לקרוא. דגלים מצוירים ב-SVG (ב-Windows אמוג׳י דגל הוא שתי אותיות).
 */
/* ───────── דגלים — מצוירים, לא אמוג׳י (ב-Windows אמוג׳י דגל הוא שתי אותיות) ───────── */
export function LeagueFlag({ country }: { country: string }) {
  if (country === 'EN_PL') {
    return (
      <svg viewBox="0 0 54 36" className="h-full w-full" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
        <rect width="54" height="36" fill="#fff" />
        <rect x="23" width="8" height="36" fill="#CE1124" />
        <rect y="14" width="54" height="8" fill="#CE1124" />
      </svg>
    );
  }
  if (country === 'ES_LALIGA') {
    return (
      <svg viewBox="0 0 54 36" className="h-full w-full" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
        <rect width="54" height="36" fill="#AA151B" />
        <rect y="9" width="54" height="18" fill="#F1BF00" />
      </svg>
    );
  }
  if (country === 'GR_SUPER') {
    return (
      <svg viewBox="0 0 54 36" className="h-full w-full" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
        <rect width="54" height="36" fill="#0D5EAF" />
        {[4, 12, 20, 28].map((y) => <rect key={y} x="0" y={y} width="54" height="4" fill="#fff" />)}
        <rect width="20" height="20" fill="#0D5EAF" />
        <rect x="8" width="4" height="20" fill="#fff" />
        <rect y="8" width="20" height="4" fill="#fff" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 54 36" className="h-full w-full" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <rect width="54" height="36" fill="#fff" />
      <rect y="4" width="54" height="5" fill="#0038B8" />
      <rect y="27" width="54" height="5" fill="#0038B8" />
      <g fill="none" stroke="#0038B8" strokeWidth="1.6">
        <path d="M27 11.5 L35 25 H19 Z" />
        <path d="M27 24.5 L35 11 H19 Z" />
      </g>
    </svg>
  );
}

const ACCENT: Record<string, string> = { IL_PREMIER: '#2F6BD8', GR_SUPER: '#1F7BD6', EN_PL: '#7B2CBF', ES_LALIGA: '#E0452B' };


/** צבע המבטא של ליגה; ליגה לא מוכרת → זהב המותג. */
export function leagueAccent(code: string | null | undefined): string {
  return (code && ACCENT[code]) || '#D8B25C';
}
