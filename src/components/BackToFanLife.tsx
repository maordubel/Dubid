import { tr } from '../lib/i18n/dict.ts';
import { trackedClick } from '../lib/ecosystem.ts';
import { backToClub, clubLabel, FANLIFE_SITE } from '../lib/league.ts';

/**
 * Connected Football (27.10.2026) — `back_to_story` (ecosystem contract): a visitor sent here by a FAN LIFE club
 * card gets one quiet way back to that club. Nothing shows for anyone who did not come from FAN LIFE.
 */
export function BackToFanLife() {
  const club = backToClub();
  if (!club) return null;
  const href = `${FANLIFE_SITE}/clubs/${club}`;
  return (
    <a
      href={href}
      className="press-folio"
      style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, textDecoration: 'underline', textUnderlineOffset: 3 }}
      onClick={(e) => trackedClick(e, href, 'dubid-back-to-story', { club })}
    >
      {tr('incoming.back', { club: clubLabel(club) })}
    </a>
  );
}
