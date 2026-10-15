import { useEffect } from 'react';

/**
 * Wide tables already sit in horizontal scroll containers. On a phone those containers were
 * neither reachable by keyboard nor visibly scrollable. While a container actually overflows,
 * this hook:
 *  - makes it a named, focusable region (tabindex=0, role=region) so arrow keys scroll it;
 *  - sets data-scroll-more="right|left|both" so CSS can fade the edge that has hidden columns.
 * Containers that fit get none of this, so desktop tables are untouched.
 */
const SCROLLERS = '.table-container, .table-wrapper, .table-responsive, .card:has(> .table), .card:has(> table)';

function nameFor(el: HTMLElement): string {
  const caption = el.querySelector('caption')?.textContent?.trim();
  if (caption) return caption;
  for (let p: HTMLElement | null = el; p && p !== document.body; p = p.parentElement) {
    const h = p.querySelector('h1, h2, h3, h4, .section-title');
    if (h && h !== el && !el.contains(h) && h.textContent?.trim()) return `${h.textContent.trim()} table`;
    if (p.previousElementSibling?.matches('h1, h2, h3, h4, .section-title')) return `${p.previousElementSibling.textContent?.trim()} table`;
  }
  return 'Data table';
}

export function useScrollRegionA11y(): void {
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    let selectorOk = true;
    try { document.querySelector(SCROLLERS); } catch { selectorOk = false; }
    const selector = selectorOk ? SCROLLERS : '.table-container, .table-wrapper, .table-responsive';
    const tracked = new Set<HTMLElement>();

    const edge = (el: HTMLElement) => {
      const max = el.scrollWidth - el.clientWidth;
      const left = el.scrollLeft > 1, right = el.scrollLeft < max - 1;
      const v = left && right ? 'both' : right ? 'right' : left ? 'left' : '';
      if (v) el.dataset.scrollMore = v; else delete el.dataset.scrollMore;
    };
    const onScroll = (e: Event) => edge(e.currentTarget as HTMLElement);

    const update = () => {
      document.querySelectorAll<HTMLElement>(selector).forEach(el => {
        const overflowing = el.scrollWidth > el.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowX);
        const ours = el.dataset.scrollRegion === 'true';
        if (overflowing && !ours) {
          el.dataset.scrollRegion = 'true';
          if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
          if (!el.hasAttribute('role')) el.setAttribute('role', 'region');
          if (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby')) { el.setAttribute('aria-label', nameFor(el)); el.dataset.scrollLabel = 'true'; }
          el.addEventListener('scroll', onScroll, { passive: true });
          tracked.add(el);
        } else if (!overflowing && ours) {
          delete el.dataset.scrollRegion;
          delete el.dataset.scrollMore;
          if (el.getAttribute('tabindex') === '0') el.removeAttribute('tabindex');
          if (el.getAttribute('role') === 'region') el.removeAttribute('role');
          if (el.dataset.scrollLabel) { el.removeAttribute('aria-label'); delete el.dataset.scrollLabel; }
          el.removeEventListener('scroll', onScroll);
          tracked.delete(el);
        }
        if (overflowing) edge(el);
      });
      for (const el of [...tracked]) if (!el.isConnected) tracked.delete(el);
    };

    let queued = false;
    const schedule = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; update(); });
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      tracked.forEach(el => el.removeEventListener('scroll', onScroll));
    };
  }, []);
}
