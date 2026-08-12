import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { field as s } from '@modeler/inspector/styles';

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 4;
const HIDE_DELAY_MS = 150;

export function HelpTooltip({
  name,
  description,
  wide = true,
  testId,
}: {
  name: string;
  description?: string;
  wide?: boolean;
  testId?: string;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>();

  // Portaled to <body>: the panel's backdrop-filter would otherwise re-anchor `position: fixed` to it.
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
      data-testid={testId}
      onMouseEnter={show}
      onMouseLeave={scheduleHide}
    >
      <i className={s.helpIcon}></i>
      {open && createPortal(
        <div
          ref={tipRef}
          data-testid={testId ? `${testId}-bubble` : undefined}
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

export function CheckIcon() {
  return (
    <svg className={s.checkboxIcon} viewBox="0 0 14 14" fill="none">
      <path d="M3 8L6 11L11 3.5" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
