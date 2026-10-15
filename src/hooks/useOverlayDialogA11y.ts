import { useEffect } from 'react';

/**
 * Dialog semantics for the app's existing `.drawer-overlay` / `.modal-overlay` pop-ups.
 *
 * About 70 pages render their own overlay markup, and only a handful had dialog semantics.
 * Rather than rewrite each one, this adds the missing behaviour to whatever overlay is open:
 *  - the panel inside the overlay becomes role="dialog" + aria-modal, named by its first heading;
 *  - focus moves into the dialog when it opens, Tab stays inside it, and focus returns to the
 *    control that opened it when it closes;
 *  - Escape does exactly what a click on the backdrop already does on that page (so a dialog
 *    that does not close on backdrop click does not close on Escape either);
 *  - icon-only close (X) buttons without a name get aria-label="Close".
 * Overlays whose panel already declares role="dialog" keep their own Escape handling.
 *
 * It only adds attributes and listeners; no page state, handler or data flow is changed.
 */
const OVERLAY = '.drawer-overlay, .modal-overlay';
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const isShown = (el: Element) => {
  const r = (el as HTMLElement).getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

let headingSeq = 0;

export function useOverlayDialogA11y(): void {
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    const opener = new WeakMap<Element, Element | null>();
    const open = new Set<HTMLElement>();
    let lastFocus: Element | null = document.activeElement;

    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as Element | null;
      if (t && !t.closest(OVERLAY)) lastFocus = t;
    };

    const enhance = (overlay: HTMLElement) => {
      overlay.dataset.dialogReady = 'true';
      const panel = (overlay.firstElementChild as HTMLElement | null) ?? overlay;
      // a dialog that already declared its own semantics also handles its own Escape key
      if (panel.getAttribute('role') === 'dialog') overlay.dataset.dialogOwned = 'true';
      if (!panel.hasAttribute('role')) panel.setAttribute('role', 'dialog');
      if (!panel.hasAttribute('aria-modal')) panel.setAttribute('aria-modal', 'true');
      if (!panel.hasAttribute('aria-label') && !panel.hasAttribute('aria-labelledby')) {
        const heading = panel.querySelector('h1, h2, h3, h4');
        if (heading) {
          if (!heading.id) heading.id = `overlay-dialog-title-${++headingSeq}`;
          panel.setAttribute('aria-labelledby', heading.id);
        }
      }
      panel.querySelectorAll('button').forEach(btn => {
        if (btn.hasAttribute('aria-label') || btn.title || btn.textContent?.trim()) return;
        if (btn.querySelector('svg.lucide-x')) btn.setAttribute('aria-label', 'Close');
      });
      opener.set(overlay, lastFocus);
      open.add(overlay);
      if (!panel.contains(document.activeElement)) {
        if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
        panel.focus({ preventScroll: true });
      }
    };

    const sweep = () => {
      document.querySelectorAll<HTMLElement>(`${OVERLAY}`).forEach(o => { if (!o.dataset.dialogReady) enhance(o); });
      for (const o of [...open]) {
        if (o.isConnected) continue;
        open.delete(o);
        const back = opener.get(o) as HTMLElement | null | undefined;
        const focusLost = !document.activeElement || document.activeElement === document.body;
        if (back && back.isConnected && focusLost && open.size === 0) back.focus?.({ preventScroll: true });
      }
    };

    const topmost = (): HTMLElement | null => {
      const list = [...open].filter(o => o.isConnected && isShown(o));
      return list.length ? list[list.length - 1] : null;
    };

    const onKey = (e: KeyboardEvent) => {
      const top = topmost();
      if (!top) return;
      if (e.key === 'Escape') {
        if (top.dataset.dialogOwned) return;
        e.stopPropagation();
        // same as clicking the backdrop: target === currentTarget for the page's own handler
        top.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return;
      }
      if (e.key !== 'Tab') return;
      const items = [...top.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(isShown);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!active || !top.contains(active)) { e.preventDefault(); first.focus(); return; }
      if (e.shiftKey && (active === first || !items.includes(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };

    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; sweep(); });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('keydown', onKey, true);
    sweep();
    return () => {
      observer.disconnect();
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, []);
}
