import React, { useContext, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { ModelerContext } from '../contexts';
import { executeCommand } from '../commands';
import { PALETTE_GROUPS } from '../constants/palette';
import { t } from '../../i18n';
import { useSchemaProviders } from './hooks/useSchemaProviders';
import { usePaletteDrag } from './hooks/usePaletteDrag';
import { PaletteButton } from './components/PaletteButton';
import { Popup } from './components/Popup';
import { palette } from '../styles';

function renderSchemaIcon(icon?: string): React.ReactNode {
  if (icon && /^(https?:\/\/|data:image\/)/i.test(icon)) {
    return (
      <img
        src={icon}
        alt=""
        className="h-6 w-6 object-contain"
        loading="lazy"
        decoding="async"
      />
    );
  }
  return <i className={`text-[24px] ${icon || 'iconify tabler--hexagon'}`}></i>;
}

export function Palette({ className = '' }: { className?: string }) {
  const { modeler } = useContext(ModelerContext);
  const schemas = useSchemaProviders(modeler);
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

  const getPopupPosition = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 + 35,
      y: rect.top + rect.height / 2 + 10,
      cursor: { x: event.clientX, y: event.clientY },
    };
  };

  const handleLassoToolClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (!modeler) return;
    event.preventDefault();
    executeCommand(modeler, {
      type: 'palette-activate-lasso',
      event: event.nativeEvent,
    });
  };

  const handleMoreElementsClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (!modeler) return;
    event.preventDefault();
    executeCommand(modeler, {
      type: 'palette-open-popup',
      popupType: 'bpmn-create',
      position: getPopupPosition(event),
      title: t('Create BPMN element'),
    });
  };

  const handleMoreSchemaElementsClick = (
    prefix: string,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    if (!modeler) return;
    event.preventDefault();
    executeCommand(modeler, {
      type: 'palette-open-popup',
      popupType: `${prefix}-create`,
      position: getPopupPosition(event),
      title: t('Create element'),
    });
  };

  return (
    <div
      className={`${palette.wrapper} ${className}`}
      data-testid="palette-root"
      ref={rootRef}
    >
      {/* Section 1: tools */}
      <div
        key="lasso"
        className={palette.group}
        onMouseEnter={() => { if (!pinnedGroup) setOpenGroup(null); }}
      >
        <PaletteButton title="Select elements with lasso tool" onClick={handleLassoToolClick}>
          <i className="text-[22px] iconify material-symbols--ink-selection-rounded"></i>
        </PaletteButton>
        <span className={palette.tooltip}>Select multiple elements</span>
      </div>

      <div className={palette.separator} />

      {/* Section 2: element categories */}
      {PALETTE_GROUPS.map((group) => {
        const isOpen = openGroup === group.label;
        const isPinned = pinnedGroup === group.label;
        const extraItems = schemas.flatMap((schema) =>
          schema.items.filter((item) => item.categories[0] === group.label)
        );
        return (
          <div
            key={group.label}
            className={palette.groupWithFlyout}
            onMouseEnter={() => {
              if (pinnedGroup) return;
              setOpenGroup(group.label);
            }}
            onMouseLeave={() => {
              if (!isPinned && openGroup === group.label) setOpenGroup(null);
            }}
          >
            <PaletteButton
              title={group.label}
              ariaExpanded={isOpen}
              onClick={(e) => {
                e.preventDefault();
                if (isPinned) {
                  setPinnedGroup(null);
                  setOpenGroup(null);
                } else {
                  // Pin this group; supersedes any other open or pinned popup.
                  setPinnedGroup(group.label);
                  setOpenGroup(group.label);
                }
              }}
            >
              <i className={`text-[22px] ${group.icon}`}></i>
              <span className={palette.groupChevron} />
            </PaletteButton>
            <Popup group={group} extraItems={extraItems} isOpen={isOpen} handlers={dragHandlers} />
          </div>
        );
      })}

      <div className={palette.separator} />

      {/* Section 3: more-elements popups (per schema + BPMN catch-all) */}
      {schemas.map(({ prefix, name, icon }) => (
        <div
          key={`more-${prefix}`}
          className={palette.group}
          onMouseEnter={() => { if (!pinnedGroup) setOpenGroup(null); }}
        >
          <PaletteButton
            title={`More ${name} elements...`}
            onMouseUp={dragHandlers.onMouseUp}
            onMouseLeave={dragHandlers.onMouseUp}
            onClick={(e) => handleMoreSchemaElementsClick(prefix, e)}
          >
            {renderSchemaIcon(icon)}
          </PaletteButton>
          <span className={palette.tooltip}>{name} elements...</span>
          <span className={palette.groupChevron} />
        </div>
      ))}

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
          <i className="text-[22px] iconify bi--three-dots"></i>
        </PaletteButton>
        <span className={palette.tooltip}>BPMN elements...</span>
      </div>
    </div>
  );
}
