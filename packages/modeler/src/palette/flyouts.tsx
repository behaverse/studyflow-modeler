import { useLayoutEffect, useRef } from 'react';
import type { PaletteGroup } from '@modeler/palette/groups';
import type { AddEntry } from '@modeler/palette/catalog';
import type { PaletteDraggable, PaletteDragHandlers } from '@modeler/palette/usePaletteDrag';
import { paletteFlyout } from '@modeler/palette/styles';
import { PaletteIcon } from '@modeler/palette/PaletteIcon';

/* Positions imperatively: React state would bail out on an unchanged offset and leave the cleared transform behind on re-opens. */
function useFlyoutPosition(isOpen: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      el.style.transform = '';
      const rect = el.getBoundingClientRect();
      const margin = 12;
      const overflowBottom = rect.bottom - (window.innerHeight - margin);
      const shift = Math.min(Math.max(overflowBottom, 0), Math.max(rect.top - margin, 0));
      el.style.transform = shift ? `translateY(${-shift}px)` : '';
    };

    measure();
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isOpen]);

  return { ref };
}

type TileProps = {
  draggable: PaletteDraggable;
  icon: string | undefined;
  title: string;
  label: string;
  handlers: PaletteDragHandlers;
};

function PaletteTile({ draggable, icon, title, label, handlers }: TileProps) {
  return (
    <button
      type="button"
      title={title}
      className={paletteFlyout.item}
      onPointerDown={(e) => handlers.onPointerDown(draggable, e)}
      onPointerMove={(e) => handlers.onPointerMove(draggable, e)}
      onPointerUp={handlers.onPointerUp}
      onPointerLeave={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerUp}
      onClick={(e) => handlers.onClick(draggable, e)}
    >
      <PaletteIcon icon={icon} size={22} />
      <span className={paletteFlyout.itemLabel}>{label}</span>
    </button>
  );
}

type PopupProps = {
  group: PaletteGroup;
  /** The kind's entries: BPMN's own, then the skills' (`catalog.ts`). */
  entries: AddEntry[];
  isOpen: boolean;
  handlers: PaletteDragHandlers;
};

/**
 * A kind's flyout: what is always there (BPMN's own, then the types of the skills that always load, as Core), then,
 * under a rule, what the skills a person turned on add of that kind.
 */
export function Popup({ group, entries, isOpen, handlers }: PopupProps) {
  const { ref } = useFlyoutPosition(isOpen);
  const tiles = (shown: AddEntry[]) => (
    <div className={paletteFlyout.grid}>
      {shown.map((entry) => (
        <PaletteTile
          key={entry.id}
          draggable={entry}
          icon={entry.icon}
          title={`Create ${entry.label}${entry.skill ? ` (${entry.skill.name})` : ''}`}
          label={entry.label}
          handlers={handlers}
        />
      ))}
    </div>
  );
  const always = (entry: AddEntry): boolean => !entry.skill || entry.skill.required;
  const added = entries.filter((entry) => !always(entry));
  return (
    <div ref={ref} className={paletteFlyout.panel(isOpen)}>
      <span className={paletteFlyout.gapBridge} aria-hidden="true" />

      <div className={paletteFlyout.header}>{group.label}</div>

      <div className={paletteFlyout.body}>
        {tiles(entries.filter(always))}
        {added.length > 0 && (
          <>
            <div className={paletteFlyout.rule} role="separator" />
            {tiles(added)}
          </>
        )}
      </div>
    </div>
  );
}
