import { useEffect, useRef } from 'react';
import { useApp } from '../state';

/* Category filter feedback (ported from filterCards): visible items ease in, and the new count is announced politely.
   Skipped on first render. */
export function useFilterFeedback(cat: string, selector: string, count: number) {
  const { T, announce } = useApp();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce) document.querySelectorAll<HTMLElement>(selector + ':not(.out)').forEach((el) => el.animate?.([{ opacity: 0, transform: 'translateY(8px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.2,.7,.2,1)' }));
    announce(T.n('shown', count, { cat: cat === 'All' ? T('allDesigns') : T.cat(cat) }));
  }, [cat]); // eslint-disable-line react-hooks/exhaustive-deps
}
