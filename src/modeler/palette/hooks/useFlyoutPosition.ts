import { useLayoutEffect, useRef, useState } from 'react';

/** Shift a flyout upward when its bottom would overflow the viewport. */
export function useFlyoutPosition(isOpen: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState(0);

  useLayoutEffect(() => {
    if (!isOpen) {
      setOffset(0);
      return;
    }
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      el.style.transform = '';
      const rect = el.getBoundingClientRect();
      const margin = 12;
      const overflowBottom = rect.bottom - (window.innerHeight - margin);
      if (overflowBottom <= 0) {
        setOffset(0);
        return;
      }
      // Don't shift past the top of the viewport.
      const maxShift = rect.top - margin;
      setOffset(-Math.min(overflowBottom, Math.max(maxShift, 0)));
    };

    measure();
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isOpen]);

  return {
    ref,
    style: offset ? { transform: `translateY(${offset}px)` } : undefined,
  };
}
