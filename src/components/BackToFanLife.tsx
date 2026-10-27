import { tr } from '../lib/i18n/dict.ts';
import { trackedClick } from '../lib/ecosystem.ts';
import { backContext, backLink, clubLabel } from '../lib/league.ts';

/**
 * Connected Football (27.10.2026) — `back_to_story` (ecosystem contract): a visitor sent here by FAN LIFE gets one
 * quiet way back — to the club page they came from, in their language, or to the FAN LIFE home when they came from
 * the hub. Nothing shows for anyone who did not come from FAN LIFE.
 */
export function BackToFanLife() {
  const link = backLink(backContext());
  if (!link) return null;
  const { href, club } = link;
  return (
    <a
      href={href}
      className="press-folio"
      style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, textDecoration: 'underline', textUnderlineOffset: 3 }}
      onClick={(e) => trackedClick(e, href, 'dubid-back-to-story', { club })}
    >
      {club ? tr('incoming.back', { club: clubLabel(club) }) : tr('incoming.backHub')}
    </a>
  );
}
