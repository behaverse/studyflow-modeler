import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type MouseEventHandler,
  type ReactNode,
} from 'react';
import { useRequiredModeler } from '@modeler/app/useModeler';
import { executeCommand } from '@modeler/commandBus';
import { PALETTE_GROUPS } from '@modeler/palette/groups';
import { t } from '@modeler/i18n';
import { usePaletteDrag } from '@modeler/palette/usePaletteDrag';
import { PaletteIcon } from '@modeler/palette/PaletteIcon';
import { Popup, SchemaPopup } from '@modeler/palette/flyouts';
import { palette } from '@modeler/palette/styles';
import type { PaletteSchema } from '@modeler/palette/commands';
import type { Editor } from '@modeler/editor/port';
import { ICONS } from '@modeler/icons';

type ButtonProps = {
  title: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  onMouseUp?: () => void;
  onMouseLeave?: () => void;
  ariaExpanded?: boolean;
  className?: string;
  children: ReactNode;
};

function PaletteButton({
  title,
  onClick,
  onMouseUp,
  onMouseLeave,
  ariaExpanded,
  className = '',
  children,
}: ButtonProps) {
  return (
    <button
      type="button"
      title={title}
      className={`${palette.toolButton} ${className}`.trim()}
      aria-expanded={ariaExpanded}
      onClick={onClick}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </button>
  );
}

function usePaletteSchemas(modeler: Editor): PaletteSchema[] {
  const [schemas, setSchemas] = useState<PaletteSchema[]>([]);

  useEffect(() => {
    if (!modeler) return;
    let cancelled = false;

    executeCommand(modeler, { type: 'ResolvePaletteSchemas' })
      .then((next: PaletteSchema[]) => {
        if (!cancelled) setSchemas(next);
      })
      .catch((err: unknown) => {
        console.error('Failed to resolve palette schemas; the palette will be empty.', err);
        if (!cancelled) setSchemas([]);
      });

    return () => { cancelled = true; };
  }, [modeler]);

  return schemas;
}

export function Palette({ className = '' }: { className?: string }) {
  const modeler = useRequiredModeler();
  const schemas = usePaletteSchemas(modeler);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [pinnedGroup, setPinnedGroup] = useState<string | null>(null);
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
      if (e.key === 'Escape') closeAll();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [openGroup, pinnedGroup]);

  const getPopupPosition = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 + 35,
      y: rect.top + rect.height / 2 + 10,
      cursor: { x: e.clientX, y: e.clientY },
    };
  };

  const handleLassoToolClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (!modeler) return;
    e.preventDefault();
    executeCommand(modeler, {
      type: 'PaletteActivateLasso',
      event: e.nativeEvent,
    });
  };

  const handleMoreElementsClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (!modeler) return;
    e.preventDefault();
    executeCommand(modeler, {
      type: 'PaletteOpenPopup',
      popupType: 'bpmn-create',
      position: getPopupPosition(e),
      title: t('Create BPMN element'),
    });
  };

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

  return (
    <div
      className={`${palette.wrapper} ${className}`}
      data-testid="palette-root"
      ref={rootRef}
    >
      <div
        key="lasso"
        className={palette.group}
        onMouseEnter={() => { if (!pinnedGroup) setOpenGroup(null); }}
      >
        <PaletteButton title="Select elements with lasso tool" onClick={handleLassoToolClick}>
          <PaletteIcon icon={ICONS.inkSelection} size={22} />
        </PaletteButton>
        <span className={palette.tooltip}>Select multiple elements</span>
      </div>

      <div className={palette.separator} />

      {PALETTE_GROUPS.map((group) => {
        const { isOpen, onMouseEnter, onMouseLeave, onClick } = flyoutHandlers(group.label);
        const extraItems = schemas.flatMap((schema) =>
          schema.items.filter((item) => item.categories[0] === group.label),
        );
        return (
          <div
            key={group.label}
            className={palette.groupWithFlyout}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
          >
            <PaletteButton title={group.label} ariaExpanded={isOpen} onClick={onClick}>
              <PaletteIcon icon={group.icon} size={22} />
              <span className={palette.groupChevron} />
            </PaletteButton>
            <Popup group={group} extraItems={extraItems} isOpen={isOpen} handlers={dragHandlers} />
          </div>
        );
      })}

      <div className={palette.separator} />

      {schemas
        .filter((schema) => schema.items.length > 0 || schema.templates.length > 0)
        .map((schema) => {
          const { isOpen, onMouseEnter, onMouseLeave, onClick } = flyoutHandlers(`schema:${schema.prefix}`);
          return (
            <div
              key={`more-${schema.prefix}`}
              className={palette.groupWithFlyout}
              onMouseEnter={onMouseEnter}
              onMouseLeave={onMouseLeave}
            >
              <PaletteButton title={`More ${schema.name} elements...`} ariaExpanded={isOpen} onClick={onClick}>
                <PaletteIcon icon={schema.icon ?? ICONS.hexagon} size={24} />
                <span className={palette.groupChevron} />
              </PaletteButton>
              <span className={palette.tooltip}>{schema.name} elements...</span>
              <SchemaPopup schema={schema} isOpen={isOpen} handlers={dragHandlers} />
            </div>
          );
        })}

      <div
        key="more-bpmn"
        className={palette.group}
        onMouseEnter={() => { if (!pinnedGroup) setOpenGroup(null); }}
      >
        <PaletteButton
          title="More BPMN elements..."
          onMouseUp={dragHandlers.onMouseUp}
          onMouseLeave={dragHandlers.onMouseUp}
          onClick={handleMoreElementsClick}
        >
          <PaletteIcon icon={ICONS.threeDots} size={22} />
        </PaletteButton>
        <span className={palette.tooltip}>BPMN elements...</span>
      </div>
    </div>
  );
}
