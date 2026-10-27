/**
 * lib/useDialog.ts — גיליון נגיש (H03 §6.4).
 *
 * ★ הפוקוס נכנס לגיליון, נשאר בו (Tab/Shift+Tab מסתובבים), Escape סוגר,
 *   ובסגירה חוזר לכפתור שפתח אותו. בלי ספרייה.
 */
import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialog<T extends HTMLElement>(onClose: () => void, opts: { initial?: 'first' | 'container' } = {}): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLElement | null;
    const el = ref.current;
    if (el) {
      const first = opts.initial === 'container' ? null : el.querySelector<HTMLElement>(FOCUSABLE);
      if (first) first.focus({ preventScroll: true });
      else { if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close.current(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !ref.current.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !ref.current.contains(active))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ref;
}
