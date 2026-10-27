/**
 * components/PromoBanner.tsx — הבאנר הפנימי של דובל טים, אותה מערכת כמו ב-FAN LIFE.
 *
 * באנר 320×50 שעולה מתחתית המסך 3 שניות אחרי הכניסה, נשאר 7 שניות ויורד.
 * מעבר, ריחוף או פוקוס מחזיקים אותו. אותם חוקים (`lib/promo/rules.ts`),
 * אותן תמונות, ואותן הגדרות: המסמך נקרא מלוח הבקרה של FAN LIFE
 * (`/api/promo/public`), ואם הוא לא זמין — מהזרע שבחבילה.
 * מעולם לא מעל דיאלוג, ומעולם לא יותר משלוש פעמים בביקור.
 */
import { useEffect, useRef, useState } from 'react';
import { capped, delayOf, eligible, isOwn, outbound, pageOf, pickBanner, showOf } from '../lib/promo/rules.ts';
import { SEED_DOC } from '../lib/promo/seed.ts';
import type { Banner, Page, PromoDoc, Seen } from '../lib/promo/types.ts';
import { useI18n } from '../lib/i18n/index.tsx';
import { trackedClick } from '../lib/ecosystem.ts';

const REMOTE = 'https://fanlife.dubelteam.com/api/promo/public';
const KEY = 'dubid.promo.v2';
const SKEY = 'dubid.promo.session.v2';
type Session = { seen: Seen; shown: number; last: number; lastId: string | null; stop: boolean };

function read<T>(store: 'local' | 'session', key: string, d: T): T {
  try {
    const v = (store === 'local' ? localStorage : sessionStorage).getItem(key);
    return v ? (JSON.parse(v) as T) : d;
  } catch { return d; }
}
function write(store: 'local' | 'session', key: string, v: unknown) {
  try { (store === 'local' ? localStorage : sessionStorage).setItem(key, JSON.stringify(v)); } catch { /* optional */ }
}
const blank = (): Session => ({ seen: {}, shown: 0, last: 0, lastId: null, stop: false });
const reduce = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** DUBID is one page: every screen is the same "other" page. */
const PAGE: Page = pageOf(null, '/dubid');
/** nothing slides up over a decision */
const busy = () => !!document.querySelector('dialog[open],[role="dialog"],[aria-modal="true"],[data-no-promo]');

async function loadDoc(): Promise<PromoDoc> {
  try {
    const ctl = new AbortController();
    const t = window.setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(REMOTE, { signal: ctl.signal, credentials: 'omit' });
    window.clearTimeout(t);
    if (!r.ok) return SEED_DOC;
    const d = (await r.json()) as PromoDoc;
    return d && Array.isArray(d.banners) && d.settings ? d : SEED_DOC;
  } catch { return SEED_DOC; }
}

export function PromoBanner() {
  const { t } = useI18n();
  const [doc, setDoc] = useState<PromoDoc | null>(null);
  const [shown, setShown] = useState<Banner | null>(null);
  const [up, setUp] = useState(false);
  const hold = useRef(false);
  const timers = useRef<number[]>([]);
  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };

  useEffect(() => { let off = false; void loadDoc().then((d) => { if (!off) setDoc(d); }); return () => { off = true; }; }, []);

  useEffect(() => {
    if (!doc || !doc.settings.enabled) return;
    const cap = doc.settings.maxPerSession;
    const sess0 = read<Session>('session', SKEY, blank());
    if (sess0.stop || (cap > 0 && sess0.shown >= cap)) return;
    const pool = () => {
      const now = Date.now();
      const seen = read<Seen>('local', KEY, {});
      const s = read<Session>('session', SKEY, blank());
      const list = eligible(doc, PAGE, now, { israel: true }).filter((b) => !capped(b, seen, s.seen, now));
      return { now, seen, s, list };
    };
    const p0 = pool();
    const first = pickBanner(p0.list, p0.seen, sess0.lastId, p0.now, Math.random);
    if (!first) return;
    const sinceLast = sess0.last ? Math.max(0, doc.settings.gapSec * 1000 - (p0.now - sess0.last)) : 0;
    const wait = Math.max(delayOf(first, doc.settings), sinceLast);

    const attempt = () => {
      if (hold.current || busy()) { later(attempt, 1500); return; }
      const { now, seen, s, list } = pool();
      if (s.stop || (cap > 0 && s.shown >= cap)) return;
      const b = pickBanner(list, seen, s.lastId, now, Math.random);
      if (!b) return;
      setShown(b);
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => setUp(true)));
      const t = Date.now();
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date(t));
      const sn = read<Seen>('local', KEY, {});
      const prev = sn[b.id];
      sn[b.id] = { n: (prev?.n ?? 0) + 1, last: t, day: today, dn: prev && prev.day === today ? prev.dn + 1 : 1 };
      write('local', KEY, sn);
      const ss = read<Session>('session', SKEY, blank());
      ss.seen[b.id] = { n: (ss.seen[b.id]?.n ?? 0) + 1, last: t, day: today, dn: 1 };
      ss.shown += 1; ss.last = t; ss.lastId = b.id;
      write('session', SKEY, ss);
      const close = () => {
        if (hold.current) { later(close, 1000); return; }
        setUp(false);
        later(() => {
          setShown(null);
          const s2 = read<Session>('session', SKEY, blank());
          s2.last = Date.now(); write('session', SKEY, s2);
          if (!(cap > 0 && s2.shown >= cap) && !s2.stop) later(attempt, Math.max(1000, doc.settings.gapSec * 1000));
        }, reduce() ? 0 : 460);
      };
      later(close, showOf(b, doc.settings));
    };
    later(attempt, wait);
    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  if (!shown) return null;
  const dismiss = () => {
    const ss = read<Session>('session', SKEY, blank());
    ss.stop = true; ss.last = Date.now(); write('session', SKEY, ss);
    clear(); setUp(false);
    window.setTimeout(() => setShown(null), reduce() ? 0 : 460);
  };
  return (
    <aside className="promo" data-up={up || undefined} data-promo={shown.id} role="complementary" aria-label={t('shell.ad.aria')}
      onPointerEnter={() => { hold.current = true; }} onPointerLeave={() => { hold.current = false; }}
      onFocusCapture={() => { hold.current = true; }} onBlurCapture={() => { hold.current = false; }}>
      <a className="promo-link" href={outbound(shown, PAGE)}
        onClick={(e) => { if (!isOwn(shown)) trackedClick(e, outbound(shown, PAGE), `dubid-promo-${shown.id}`); }}
        {...(isOwn(shown) ? {} : { target: '_blank', rel: 'noopener noreferrer sponsored' })}
        aria-label={shown.alt || shown.name}>
        <img src={shown.img1x} srcSet={`${shown.img1x} 1x, ${shown.img2x} 2x`} width={320} height={50}
          alt={shown.alt || shown.name} decoding="async" />
      </a>
      <button type="button" className="promo-x" onClick={dismiss} aria-label={t('shell.ad.close')}>×</button>
      <span className="promo-tag" aria-hidden="true">{t('shell.ad.tag')}</span>
    </aside>
  );
}
