/**
 * The tools column, on the left, where a study is made: the five kinds (events, activities, gateways, data,
 * containers), each opening its flyout; the entries a person pinned; and the +, which opens the Add panel
 * (`popup/addMenu.ts`) with everything the enabled skills add. However many skills are on, the column stays this
 * short: a skill's elements join their kind's flyout and the panel, not the column.
 */

import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type MouseEvent as ReactMouseEvent } from 'react';
import { useModeler } from '@modeler/app/useModeler';
import { addEntries, type AddEntry } from '@modeler/palette/catalog';
import { useCatalogVersion } from '@modeler/app/skills';
import { PALETTE_GROUPS } from '@modeler/palette/groups';
import { usePinned } from '@modeler/palette/pins';
import { usePaletteDrag, type PaletteDragHandlers } from '@modeler/palette/usePaletteDrag';
import { PaletteIcon } from '@modeler/palette/PaletteIcon';
import { Popup } from '@modeler/palette/flyouts';
import { palette } from '@modeler/palette/styles';
import { addMenu } from '@modeler/popup/addMenu';
import { PopupMenu } from '@modeler/popup/PopupMenu';
import type { PopupPosition } from '@modeler/editor/popupMenus';
import { ICONS } from '@modeler/icons';

/** The +'s key among the flyouts': its panel opens where they do, and one thing is open at a time. */
const ADD = 'add';

/** A tool's glyph, as the context pad draws its own: 18 in the 28px tool, room round it for a kind's corner mark. */
const GLYPH = 18;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { title: string; ariaExpanded?: boolean };

function PaletteButton({ ariaExpanded, className = palette.toolButton, children, ...rest }: ButtonProps) {
  return (
    <button type="button" className={className} aria-expanded={ariaExpanded} {...rest}>
      {children}
    </button>
  );
}

/** A pinned entry: a tool like the kinds' tiles, clicked to arm it or dragged out onto the canvas. */
function PinnedTool({ entry, handlers }: { entry: AddEntry; handlers: PaletteDragHandlers }) {
  return (
    <PaletteButton
      title={entry.skill ? `${entry.label} (${entry.skill.name})` : entry.label}
      className={`${palette.toolButton} touch-pan-y select-none`}
      onPointerDown={(e) => handlers.onPointerDown(entry, e)}
      onPointerMove={(e) => handlers.onPointerMove(entry, e)}
      onPointerUp={handlers.onPointerUp}
      onPointerLeave={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerUp}
      onClick={(e) => handlers.onClick(entry, e)}
    >
      <PaletteIcon icon={entry.icon} size={GLYPH} />
    </PaletteButton>
  );
}

export function Palette({ className = '' }: { className?: string }) {
  const modeler = useModeler();
  // Read once: the catalog is installed before the modeler mounts, and turning a skill off reloads the app.
  // Read again when a skill turned on replaces the catalog.
  const catalog = useCatalogVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `catalog` stands in for the catalog
  const entries = useMemo(() => addEntries(), [catalog]);
  const pinnedIds = usePinned();
  const pinned = useMemo(
    () => pinnedIds.flatMap((id) => entries.find((entry) => entry.id === id) ?? []),
    [pinnedIds, entries],
  );
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [pinnedGroup, setPinnedGroup] = useState<string | null>(null);
  /** Where the Add panel opens: beside the column, level with the +. */
  const [addAnchor, setAddAnchor] = useState<PopupPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const closeAll = () => {
    setPinnedGroup(null);
    setOpenGroup(null);
  };

  const dragHandlers = usePaletteDrag(modeler, closeAll);

  useEffect(() => {
    if (!openGroup && !pinnedGroup) return;
    const onDocClick = (e: globalThis.MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) closeAll();
    };
    const onKey = (e: KeyboardEvent) => {
      // Esc closes the innermost thing open: here the flyout, not the selection (`composer/Composer.tsx`).
      if (e.key === 'Escape') {
        e.preventDefault();
        closeAll();
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [openGroup, pinnedGroup]);

  const flyoutHandlers = (key: string) => {
    const isOpen = openGroup === key;
    const isPinned = pinnedGroup === key;
    return {
      isOpen,
      onMouseEnter: () => { if (!pinnedGroup) setOpenGroup(key); },
      onMouseLeave: () => { if (!isPinned && openGroup === key) setOpenGroup(null); },
      onClick: (e: ReactMouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        if (isPinned) closeAll();
        else { setPinnedGroup(key); setOpenGroup(key); }
      },
    };
  };

  const addOpen = pinnedGroup === ADD;
  const toggleAdd = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (addOpen) {
      closeAll();
      return;
    }
    const column = rootRef.current!.getBoundingClientRect();
    const button = e.currentTarget.getBoundingClientRect();
    // 6 right of the column, as a flyout opens; its top level with the +'s, as a menu opens from its trigger.
    const x = Math.round(column.right + 6);
    const y = Math.round(button.top - 6);
    setAddAnchor({ x, y, cursor: { x, y: Math.round(button.top + button.height / 2) } });
    setPinnedGroup(ADD);
    setOpenGroup(ADD);
  };
  const addPanel = useMemo(
    () => (addOpen && addAnchor ? addMenu(modeler, { kind: 'pointer' }, pinnedIds, addAnchor) : null),
    [addOpen, addAnchor, modeler, pinnedIds],
  );

  return (
    <div
      className={`${palette.wrapper} ${className}`}
      data-testid="palette-root"
      data-covers="left"
      ref={rootRef}
    >
      {PALETTE_GROUPS.map((group) => {
        const { isOpen, onMouseEnter, onMouseLeave, onClick } = flyoutHandlers(group.label);
        return (
          <div
            key={group.label}
            className={palette.groupWithFlyout}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
          >
            <PaletteButton title={group.label} ariaExpanded={isOpen} onClick={onClick}>
              <PaletteIcon icon={group.icon} size={GLYPH} />
              <span className={palette.groupMark} aria-hidden="true" />
            </PaletteButton>
            <Popup
              group={group}
              entries={entries.filter((entry) => entry.kind === group.label && !entry.template)}
              isOpen={isOpen}
              handlers={dragHandlers}
            />
          </div>
        );
      })}

      <div className={palette.separator} />

      {/* Moving onto a pin or the + closes a flyout the pointer opened on the way. */}
      <div className={palette.stack} onMouseEnter={() => { if (!pinnedGroup) setOpenGroup(null); }}>
        {pinned.map((entry) => <PinnedTool key={entry.id} entry={entry} handlers={dragHandlers} />)}
        <PaletteButton
          title="Add..."
          className={palette.addButton}
          ariaExpanded={addOpen}
          onClick={toggleAdd}
          data-popup-toggle
        >
          <i className={ICONS.plus} style={{ fontSize: GLYPH }} aria-hidden="true" />
        </PaletteButton>
      </div>

      {addPanel && addAnchor && <PopupMenu anchor={addAnchor} menu={addPanel} onClose={closeAll} />}
    </div>
  );
}
