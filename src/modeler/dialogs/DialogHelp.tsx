import { type ReactNode, useState } from 'react';

/**
 * Help icon for a dialog title. Hovering the icon reveals the tooltip below
 * the title; clicking pins it (toggles open). The visual style mirrors the
 * inspector's HelpTooltip but positions the bubble below the trigger so it
 * doesn't escape the dialog panel.
 */
export function DialogHelp({ children }: { children: ReactNode }) {
  const [pinned, setPinned] = useState(false);

  return (
    <span className="relative group/help inline-flex items-center">
      <button
        type="button"
        onClick={() => setPinned((v) => !v)}
        aria-label="Show help"
        aria-expanded={pinned}
        className="text-stone-400 hover:text-stone-700 cursor-pointer p-0.5 leading-none"
      >
        <i className="iconify bi--patch-question text-base"></i>
      </button>
      <span
        className={
          'absolute top-full left-0 mt-2 z-50 w-80 max-w-[24rem] ' +
          'bg-stone-900 text-xs text-cream-200 p-3 rounded-lg shadow-xl ' +
          'font-normal normal-case leading-snug ' +
          (pinned
            ? 'visible'
            : 'invisible group-hover/help:visible')
        }
        role="tooltip"
      >
        {children}
      </span>
    </span>
  );
}
