import React, { useContext, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { ModelerContext } from '../contexts';
import { executeCommand } from '../commands';
import type { PaletteSchemaDescriptor } from '../commands/paletteSetup';
import { t } from '../../i18n';

type PaletteEntry = {
  key: string;
  label: string;
  bpmnType: string;
  studyflowType?: string;
  icon?: string;
  title?: string;
};

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

function loadBpmnEntries(): PaletteEntry[] {
  return [
    {
      key: 'bpmn:StartEvent',
      label: 'Start',
      bpmnType: 'bpmn:StartEvent',
      studyflowType: 'studyflow:StartEvent',
      icon: 'iconify bpmn--start-event-none',
      title: 'Create Start Event',
    },
    {
      key: 'bpmn:EndEvent',
      label: 'End',
      bpmnType: 'bpmn:EndEvent',
      studyflowType: 'studyflow:EndEvent',
      icon: 'iconify bpmn--end-event-none',
      title: 'Create End Event',
    },
    {
      key: 'bpmn:Task',
      label: 'Task',
      bpmnType: 'bpmn:Task',
      icon: 'iconify bpmn--task-none',
      title: 'Create Task',
    },
    {
      key: 'bpmn:Group',
      label: 'Group',
      bpmnType: 'bpmn:Group',
      icon: 'iconify bpmn--group',
      title: 'Create Group',
    }
  ];
}

export function Palette({ className = '' }: { className?: string }) {
  const { modeler } = useContext(ModelerContext);
  const [entries, setEntries] = useState<PaletteEntry[]>([]);
  const [pressedEntryKey, setPressedEntryKey] = useState<string | null>(null);
  const [schemas, setSchemas] = useState<PaletteSchemaDescriptor[]>([]);
  const mouseDownRef = useRef(false);
  const startedRef = useRef(false);

  const registeredSchemasRef = useRef<Set<string>>(new Set());
  const lastModelerRef = useRef<any>(null);

  useEffect(() => {
    if (!modeler) return;
    let isCancelled = false;

    if (lastModelerRef.current !== modeler) {
      // Modeler can be recreated (e.g. React dev StrictMode). Providers are
      // registered on the modeler's popupMenu instance, so we must re-register
      // them for each new modeler.
      registeredSchemasRef.current = new Set();
      lastModelerRef.current = modeler;
    }

    // Only show core BPMN tools in the main palette.
    setEntries(loadBpmnEntries());

    executeCommand(modeler, {
      type: 'palette-register-schema-providers',
      registeredSchemas: registeredSchemasRef.current,
    })
      .then((nextSchemas: PaletteSchemaDescriptor[]) => {
        if (!isCancelled) {
          setSchemas(nextSchemas);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setSchemas([]);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [modeler]);

  useEffect(() => {
    const handleWindowMouseUp = () => setPressedEntryKey(null);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => window.removeEventListener('mouseup', handleWindowMouseUp);
  }, []);

  const handleClick = (entry: PaletteEntry, event: ReactMouseEvent) => {
    if (!modeler) return;
    event.preventDefault();
    // If drag path already started, just reset flags.
    if (startedRef.current) {
      startedRef.current = false;
      mouseDownRef.current = false;
      setPressedEntryKey(null);
      return;
    }
    // Click-to-pick: start create; user will click canvas to drop.
    executeCommand(modeler, {
      type: 'palette-start-create',
      bpmnType: entry.bpmnType,
      event: event.nativeEvent,
      attrs: {},
      studyflowType: entry.studyflowType,
    });
    setPressedEntryKey(null);
  };

  const handleMouseDown = (entry: PaletteEntry, event: ReactMouseEvent) => {
    mouseDownRef.current = true;
    startedRef.current = false;
    setPressedEntryKey(entry.key);
    event.preventDefault();
  };

  const handleMouseMove = (entry: PaletteEntry, event: ReactMouseEvent) => {
    if (!modeler) return;
    if (!mouseDownRef.current || startedRef.current) return;
    startedRef.current = true;
    event.preventDefault();
    // Start drag-create on first move with button down.
    executeCommand(modeler, {
      type: 'palette-start-create',
      bpmnType: entry.bpmnType,
      event: event.nativeEvent,
      attrs: {},
      studyflowType: entry.studyflowType,
    });
  };

  const handleMouseUp = () => {
    mouseDownRef.current = false;
    setPressedEntryKey(null);
  };

  const getPopupPosition = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 + 35,
      y: rect.top + rect.height / 2 + 10,
      cursor: {
        x: event.clientX,
        y: event.clientY,
      },
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

  const paletteEntries = useMemo(() => entries, [entries]);

  return (
    <div className={`fixed top-20 left-2 z-2 flex flex-col ${className}`}>
      {paletteEntries.map((entry) => (
        <div
          key={entry.key}
          className="group mb-2 flex items-center gap-2"
        >
          <button
            type="button"
            title={entry.title}
            className="flex palette-button"
            onMouseDown={(e) => handleMouseDown(entry, e)}
            onMouseMove={(e) => handleMouseMove(entry, e)}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onClick={(e) => handleClick(entry, e)}
          >
            <i className={`text-[24px] ${entry.icon}`}></i>
          </button>
          <span
            className={`text-sm text-violet-700 whitespace-nowrap ${
              pressedEntryKey ? 'hidden' : 'hidden group-hover:inline-block'
            }`}
          >
            {entry.label}
          </span>
        </div>
      ))}
      <div className="mt-3 flex flex-col gap-1">
        <div
          key="lasso"
          className="group flex items-center gap-2"
        >
          <button
            type="button"
            title="Select elements with lasso tool"
            className="flex palette-button-tool"
            onClick={handleLassoToolClick}
          >
            <i className={`text-[24px] iconify material-symbols--ink-selection-rounded`}></i>
          </button>
          <span
            className={`text-sm text-violet-700 whitespace-nowrap ${
              pressedEntryKey ? 'hidden' : 'hidden group-hover:inline-block'
            }`}
          >Select Elements (Lasso)</span>
        </div>
        {schemas.map(({ prefix, icon }) => (
          <div
            key={`more-${prefix}`}
            className="group flex items-center gap-2"
          >
            <button
              type="button"
              title={`More ${prefix} elements...`}
              className="flex palette-button-tool"
              onMouseDown={(e) => { }}
              onMouseMove={(e) => { }}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onClick={(e) => handleMoreSchemaElementsClick(prefix, e)}
            >
              {renderSchemaIcon(icon)}
            </button>
            <span
              className={`text-sm text-violet-700 whitespace-nowrap ${
                pressedEntryKey ? 'hidden' : 'hidden group-hover:inline-block'
              }`}
            >
              {prefix} elements...
            </span>
          </div>
        ))}
        <div
          key="more-bpmn"
          className="group flex items-center gap-2"
        >
          <button
            type="button"
            title="More BPMN elements..."
            className="flex palette-button-tool"
            onMouseDown={(e) => { }}
            onMouseMove={(e) => { }}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onClick={handleMoreElementsClick}
          >
            <i className={`text-[24px] iconify bi--three-dots`}></i>
          </button>
          <span
            className={`text-sm text-violet-700 whitespace-nowrap ${
              pressedEntryKey ? 'hidden' : 'hidden group-hover:inline-block'
            }`}
          >
            More BPMN elements...
          </span>
        </div>
      </div>
    </div>
  );
}