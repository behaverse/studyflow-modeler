import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { field as s } from '../styles';

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 4;
const HIDE_DELAY_MS = 150;

/** Help-icon tooltip next to a field label; `wide` is used for longer descriptions. */
export function HelpTooltip({
  name,
  description,
  wide = true,
}: {
  name: string;
  description?: string;
  wide?: boolean;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>();

  // The tooltip is portaled to <body> (the inspector panel's backdrop-filter
  // would otherwise re-anchor `position: fixed` to the panel). Measure it once
  // it exists, prefer above the icon, and flip/clamp to stay in the viewport.
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current?.getBoundingClientRect();
    const tip = tipRef.current?.getBoundingClientRect();
    if (!anchor || !tip) return;

    let top = anchor.top - tip.height - ANCHOR_GAP;
    if (top < VIEWPORT_MARGIN) top = anchor.bottom + ANCHOR_GAP;
    top = Math.min(top, window.innerHeight - tip.height - VIEWPORT_MARGIN);

    let left = anchor.right - tip.width;
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, window.innerWidth - tip.width - VIEWPORT_MARGIN));

    setPosition({ top, left });
  }, [open]);

  useEffect(() => () => clearTimeout(hideTimer.current), []);

  // Hovering the bubble itself keeps it open; the delay covers the small gap
  // between the icon and the bubble.
  const show = () => {
    clearTimeout(hideTimer.current);
    setOpen(true);
  };

  const scheduleHide = () => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      setOpen(false);
      setPosition(undefined);
    }, HIDE_DELAY_MS);
  };

  return (
    <div
      className={s.helpAnchor}
      ref={anchorRef}
      onMouseEnter={show}
      onMouseLeave={scheduleHide}
    >
      <i className={s.helpIcon}></i>
      {open && createPortal(
        <div
          ref={tipRef}
          style={position ?? { visibility: 'hidden' }}
          className={wide ? s.helpTooltipWide : s.helpTooltip}
          onMouseEnter={show}
          onMouseLeave={scheduleHide}
        >
          <pre className={s.helpTooltipName}>{name}</pre>
          {description}
        </div>,
        document.body,
      )}
    </div>
  );
}
