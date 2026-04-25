import React, { useContext, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { ModelerContext } from '../contexts';
import { executeCommand } from '../commands';
import { PALETTE_GROUPS } from '../constants/palette';
import { t } from '../../i18n';
import { useSchemaProviders } from './hooks/useSchemaProviders';
import { usePaletteDrag } from './hooks/usePaletteDrag';
import { PaletteButton } from './components/PaletteButton';
import { Popup } from './components/Popup';

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
  const rootRef = useRef<HTMLDivElement>(null);

  const dragHandlers = usePaletteDrag(modeler, () => setOpenGroup(null));

  useEffect(() => {
    if (!openGroup) return;
    const onDocClick = (e: globalThis.MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpenGroup(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenGroup(null);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [openGroup]);

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
      className={`fixed top-1/2 -translate-y-1/2 left-0 z-50 flex flex-col
                  rounded-r-xl bg-stone-800/90 backdrop-blur-2xl
                  border border-white/10 border-l-0
                  shadow-[2px_0_10px_rgba(0,0,0,0.20),6px_0_28px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.08)]
                  py-1.5 px-1 gap-0.5
                  ${className}`}
      data-testid="palette-root"
      ref={rootRef}
    >
      <div key="lasso" className="group relative flex items-center" onMouseEnter={() => setOpenGroup(null)}>
        <PaletteButton title="Select elements with lasso tool" onClick={handleLassoToolClick}>
          <i className="text-[22px] iconify material-symbols--ink-selection-rounded"></i>
        </PaletteButton>
        <span className="palette-tooltip">Select multiple elements</span>
      </div>

      {PALETTE_GROUPS.map((group) => {
        const isOpen = openGroup === group.label;
        const extraItems = schemas.flatMap((schema) =>
          schema.items.filter((item) => item.categories[0] === group.label)
        );
        return (
          <div
            key={group.label}
            className="group/palgroup relative flex items-center"
            onMouseEnter={() => {
              if (openGroup && openGroup !== group.label) setOpenGroup(null);
            }}
          >
            <PaletteButton
              title={group.label}
              ariaExpanded={isOpen}
              onClick={(e) => {
                e.preventDefault();
                setOpenGroup(isOpen ? null : group.label);
              }}
            >
              <i className={`text-[22px] ${group.icon}`}></i>
              <span className="absolute right-[3px] top-1/2 w-[3px] h-[3px] border-r-[1.4px] border-b-[1.4px] border-stone-200 rotate-[-45deg] -translate-y-1/2" />
            </PaletteButton>
            <Popup group={group} extraItems={extraItems} isOpen={isOpen} handlers={dragHandlers} />
          </div>
        );
      })}

      <div className="my-1 h-px bg-white/10 mx-1" />

      {schemas.map(({ prefix, icon }) => (
        <div
          key={`more-${prefix}`}
          className="group relative flex items-center"
          onMouseEnter={() => setOpenGroup(null)}
        >
          <PaletteButton
            title={`More ${prefix} elements...`}
            onMouseUp={dragHandlers.onMouseUp}
            onMouseLeave={dragHandlers.onMouseUp}
            onClick={(e) => handleMoreSchemaElementsClick(prefix, e)}
          >
            {renderSchemaIcon(icon)}
          </PaletteButton>
          <span className="palette-tooltip">{prefix} elements…</span>
          <span className="absolute right-[3px] top-1/2 w-[3px] h-[3px] border-r-[1.4px] border-b-[1.4px] border-stone-200 rotate-[-45deg] -translate-y-1/2" />
        </div>
      ))}

      <div key="more-bpmn" className="group relative flex items-center" onMouseEnter={() => setOpenGroup(null)}>
        <PaletteButton
          title="More BPMN elements..."
          onMouseUp={dragHandlers.onMouseUp}
          onMouseLeave={dragHandlers.onMouseUp}
          onClick={handleMoreElementsClick}
        >
          <i className="text-[22px] iconify bi--three-dots"></i>
        </PaletteButton>
        <span className="palette-tooltip">More BPMN…</span>
      </div>
    </div>
  );
}
