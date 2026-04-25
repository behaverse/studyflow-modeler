import { forwardRef, type MouseEvent, type ReactNode } from 'react';

type Props = {
  /** Tooltip label. */
  title: string;
  /** Iconify class (e.g., `'iconify bi--download'`). */
  icon: string;
  /** Visible label to the right of the icon. */
  label: ReactNode;
  /** Extra classes merged into the `w-full text-left` button. */
  className?: string;
  /** Click handler — fires before any menu-level `onClick` passed by the parent. */
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
};

/**
 * Shared menu action button used inside HeadlessUI `MenuItem` slots.
 *
 * The `forwardRef` wrapper matters: HeadlessUI's `MenuItem as={...}` can
 * attach a ref for focus management, so non-forwarded components lose
 * keyboard navigation on some releases.
 */
export const MenuItemButton = forwardRef<HTMLButtonElement, Props>(
  function MenuItemButton({ title, icon, label, className = '', onClick }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        title={title}
        className={`w-full text-left ${className}`}
        onClick={onClick}
      >
        <i className={`${icon} pe-2`}></i>
        {label}
      </button>
    );
  },
);
