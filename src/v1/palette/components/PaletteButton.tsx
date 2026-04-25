import { type MouseEventHandler, type ReactNode } from 'react';

type Props = {
  title: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  onMouseUp?: () => void;
  onMouseLeave?: () => void;
  ariaExpanded?: boolean;
  className?: string;
  children: ReactNode;
};

/** Common styled icon button used across the palette. */
export function PaletteButton({
  title,
  onClick,
  onMouseUp,
  onMouseLeave,
  ariaExpanded,
  className = '',
  children,
}: Props) {
  return (
    <button
      type="button"
      title={title}
      className={`palette-tool-btn ${className}`.trim()}
      aria-expanded={ariaExpanded}
      onClick={onClick}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </button>
  );
}
