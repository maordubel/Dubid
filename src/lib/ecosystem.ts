/**
 * lib/ecosystem.ts — DUBID's wiring into the shared layer (schema `shared`).
 *
 * Only the functions of `ecosystem/sdk.ts` are used; this file decides WHEN.
 * Every call is fire-and-forget: the SDK never throws, and nothing here awaits
 * on the render path.
 */
import { arrived, createHandoff, receiveHandoff, type AppId, type SharedClient } from '../../ecosystem/sdk.ts';
import { supabase } from './supabase.ts';
import { subscribeToIdentity } from './identity.ts';

const client = supabase as unknown as SharedClient;

let booted = false;
/** The auth id the last `arrived` ran for — strict mode and repeated emits call once per identity. */
let arrivedFor: string | null = null;

/** Once, as early as possible: count a landing handoff, then follow the session. */
export function bootEcosystem(): void {
  if (booted || typeof window === 'undefined') return;
  booted = true;
  void receiveHandoff(client).catch(() => {});
  subscribeToIdentity((id) => {
    if (!id.online || !id.id || id.id === arrivedFor) return;
    arrivedFor = id.id;
    void arrived(client, 'dubid').catch(() => {});
  });
}

const HOSTS: Record<string, AppId> = {
  'fanlife.dubelteam.com': 'fanlife',
  'offsides.dubelteam.com': 'offsides',
};

/** Which shared app a link points at, or null for anything else. */
export function ecosystemTarget(href: string): AppId | null {
  try { return HOSTS[new URL(href).hostname] ?? null; } catch { return null; }
}

/** `dubid-promo-<id>` style slug: lowercase, [a-z0-9_-], ≤60. */
export function campaignSlug(...parts: string[]): string {
  return parts.join('-').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 60);
}

/**
 * onClick for an outbound <a>: a plain left click becomes a tracked handoff
 * link; middle/modified clicks and non-ecosystem hosts keep the href as is.
 */
export function trackedClick(e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean; preventDefault: () => void }, href: string, campaign: string, opts: { newTab?: boolean; club?: string | null } = {}): void {
  const to = ecosystemTarget(href);
  if (!to || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  let path = '/';
  let club = opts.club ?? null;
  try {
    const u = new URL(href);
    path = u.pathname + u.search + u.hash;
    if (!club && to === 'fanlife') club = /^\/clubs\/([a-z0-9-]+)/.exec(u.pathname)?.[1] ?? null;
  } catch { /* keep defaults */ }
  e.preventDefault();
  const newTab = opts.newTab !== false;
  // Open the tab inside the click (popup blockers), point it once the link exists.
  let w: Window | null = null;
  if (newTab) {
    try { w = window.open('', '_blank'); if (w) w.opener = null; } catch { w = null; }
  }
  const go = (url: string) => {
    try {
      if (w && !w.closed) w.location.href = url;
      else if (newTab) window.open(url, '_blank', 'noopener,noreferrer');
      else window.location.href = url;
    } catch { window.location.href = url; }
  };
  createHandoff(client, { from: 'dubid', to, club, campaign: campaignSlug(campaign), path })
    .then(go, () => go(href));
}
