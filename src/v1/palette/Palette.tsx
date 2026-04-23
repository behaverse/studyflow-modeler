import React, { useContext, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { ModelerContext } from '../contexts';
import { executeCommand } from '../commands';
import type { PaletteSchemaDescriptor } from '../commands/paletteSetup';
import { t } from '../../i18n';

type PaletteEntry = {
  label: string;
  bpmnType: string;
  studyflowType?: string;
  icon: string;
};

type PaletteGroup = {
  label: string;
  icon: string;
  items: PaletteEntry[];
};

const PALETTE_GROUPS: PaletteGroup[] = [
  {
    label: 'Events',
    icon: 'iconify bpmn--start-event-none',
    items: [
      { label: 'Start', bpmnType: 'bpmn:StartEvent', studyflowType: 'studyflow:StartEvent', icon: 'iconify bpmn--start-event-none' },
      { label: 'Intermediate', bpmnType: 'bpmn:IntermediateThrowEvent', icon: 'iconify bpmn--intermediate-event-none' },
      { label: 'End', bpmnType: 'bpmn:EndEvent', studyflowType: 'studyflow:EndEvent', icon: 'iconify bpmn--end-event-none' },
    ],
  },
  {
    label: 'Activities',
    icon: 'iconify bpmn--task-none',
    items: [
      { label: 'Task', bpmnType: 'bpmn:Task', icon: 'iconify bpmn--task-none' },
      { label: 'User', bpmnType: 'bpmn:UserTask', icon: 'iconify bpmn--user-task' },
      { label: 'Script', bpmnType: 'bpmn:ScriptTask', icon: 'iconify bpmn--script-task' },
      { label: 'Service', bpmnType: 'bpmn:ServiceTask', icon: 'iconify bpmn--service-task' },
      { label: 'Manual', bpmnType: 'bpmn:ManualTask', icon: 'iconify bpmn--manual-task' },
      { label: 'Sub-Process', bpmnType: 'bpmn:SubProcess', icon: 'iconify bpmn--subprocess-expanded' },
    ],
  },
  {
    label: 'Gateways',
    icon: 'iconify bpmn--gateway-none',
    items: [
      { label: 'Exclusive', bpmnType: 'bpmn:ExclusiveGateway', icon: 'iconify bpmn--gateway-xor' },
      { label: 'Parallel', bpmnType: 'bpmn:ParallelGateway', icon: 'iconify bpmn--gateway-parallel' },
      { label: 'Inclusive', bpmnType: 'bpmn:InclusiveGateway', icon: 'iconify bpmn--gateway-or' },
      { label: 'Complex', bpmnType: 'bpmn:ComplexGateway', icon: 'iconify bpmn--gateway-complex' },
      { label: 'Event', bpmnType: 'bpmn:EventBasedGateway', icon: 'iconify bpmn--gateway-eventbased' },
    ],
  },
  {
    label: 'Containers',
    icon: 'iconify bpmn--participant',
    items: [
      { label: 'Pool', bpmnType: 'bpmn:Participant', icon: 'iconify bpmn--participant' },
      { label: 'Group', bpmnType: 'bpmn:Group', icon: 'iconify bpmn--group' },
    ],
  },
  {
    label: 'Data & Artifacts',
    icon: 'iconify bpmn--data-object',
    items: [
      { label: 'Data Object', bpmnType: 'bpmn:DataObjectReference', icon: 'iconify bpmn--data-object' },
      { label: 'Data Store', bpmnType: 'bpmn:DataStoreReference', icon: 'iconify bpmn--data-store' },
    ],
  },
];

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
  const [schemas, setSchemas] = useState<PaletteSchemaDescriptor[]>([]);
  const mouseDownRef = useRef(false);
  const startedRef = useRef(false);

  const registeredSchemasRef = useRef<Set<string>>(new Set());
  const lastModelerRef = useRef<any>(null);

  useEffect(() => {
    if (!modeler) return;
    let isCancelled = false;

    if (lastModelerRef.current !== modeler) {
      registeredSchemasRef.current = new Set();
      lastModelerRef.current = modeler;
    }

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

  const handleClick = (entry: PaletteEntry, event: ReactMouseEvent) => {
    if (!modeler) return;
    event.preventDefault();
    if (startedRef.current) {
      startedRef.current = false;
      mouseDownRef.current = false;
      return;
    }
    executeCommand(modeler, {
      type: 'palette-start-create',
      bpmnType: entry.bpmnType,
      event: event.nativeEvent,
      attrs: {},
      studyflowType: entry.studyflowType,
    });
  };

  const handleMouseDown = (_entry: PaletteEntry, event: ReactMouseEvent) => {
    mouseDownRef.current = true;
    startedRef.current = false;
    event.preventDefault();
  };

  const handleMouseMove = (entry: PaletteEntry, event: ReactMouseEvent) => {
    if (!modeler) return;
    if (!mouseDownRef.current || startedRef.current) return;
    startedRef.current = true;
    event.preventDefault();
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

  return (
    <div className={`fixed top-1/2 -translate-y-1/2 left-0 z-50 flex flex-col
                     rounded-r-[14px] bg-stone-100/85 backdrop-blur-2xl
                     border border-white/70 border-l-0
                     shadow-[2px_0_10px_rgba(0,0,0,0.08),6px_0_28px_rgba(0,0,0,0.10),inset_0_1px_0_rgba(255,255,255,0.9)]
                     py-1.5 px-1 gap-0.5
                     ${className}`} data-testid="palette-root">
      {PALETTE_GROUPS.map((group, groupIdx) => (
        <React.Fragment key={group.label}>
          {groupIdx > 0 && <div className="my-1 h-px mx-1" />}
          <div className="group/palgroup relative flex items-center">
            <button
              type="button"
              title={group.label}
              className="palette-tool-btn relative"
              tabIndex={-1}
            >
              <i className={`text-[22px] ${group.icon}`}></i>
              <span className="absolute right-[3px] top-1/2 w-[3px] h-[3px] border-r-[1.4px] border-b-[1.4px] border-stone-400 rotate-[-45deg] -translate-y-1/2 opacity-70" />
            </button>

            {/* Flyout */}
            <div className="invisible opacity-0 group-hover/palgroup:visible group-hover/palgroup:opacity-100
                            transition-all duration-150
                            absolute left-[calc(100%+5px)] top-[-6px] z-[300]
                            w-[220px] p-2.5 pb-3
                            rounded-r-[14px] bg-stone-100/80 backdrop-blur-2xl
                            border border-white/60
                            shadow-[0_1px_2px_rgba(0,0,0,0.05),0_8px_24px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.85)]
                            pointer-events-none group-hover/palgroup:pointer-events-auto">
              {/* Gap bridge so hover stays active between button and flyout */}
              <span className="absolute left-[-10px] top-0 w-[10px] h-full" aria-hidden="true" />

              <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-stone-500
                              pb-2 mb-2 px-1 border-b border-black/6">
                {group.label}
              </div>
              <div className="grid grid-cols-3 gap-1">
                {group.items.map((item) => (
                  <button
                    key={item.bpmnType}
                    type="button"
                    title={`Create ${item.label}`}
                    className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg
                               text-black hover:text-purple-600 hover:bg-purple-50
                               transition-colors cursor-grab active:cursor-grabbing"
                    onMouseDown={(e) => handleMouseDown(item, e)}
                    onMouseMove={(e) => handleMouseMove(item, e)}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    onClick={(e) => handleClick(item, e)}
                  >
                    <i className={`text-[22px] ${item.icon}`}></i>
                    <span className="text-[9.5px] font-semibold leading-tight text-center">
                      {item.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </React.Fragment>
      ))}

      <div className="my-1 h-px bg-black/8 mx-1" />

      <div className="flex flex-col gap-0.5">
        <div key="lasso" className="group relative flex items-center">
          <button
            type="button"
            title="Select elements with lasso tool"
            className="palette-tool-btn"
            onClick={handleLassoToolClick}
          >
            <i className="text-[22px] iconify material-symbols--ink-selection-rounded"></i>
          </button>
          <span className="palette-tooltip">Lasso Select</span>
        </div>
        {schemas.map(({ prefix, icon }) => (
          <div key={`more-${prefix}`} className="group relative flex items-center">
            <button
              type="button"
              title={`More ${prefix} elements...`}
              className="palette-tool-btn"
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onClick={(e) => handleMoreSchemaElementsClick(prefix, e)}
            >
              {renderSchemaIcon(icon)}
            </button>
            <span className="palette-tooltip">{prefix} elements…</span>
          </div>
        ))}
        <div key="more-bpmn" className="group relative flex items-center">
          <button
            type="button"
            title="More BPMN elements..."
            className="palette-tool-btn"
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onClick={handleMoreElementsClick}
          >
            <i className="text-[22px] iconify bi--three-dots"></i>
          </button>
          <span className="palette-tooltip">More BPMN…</span>
        </div>
      </div>
    </div>
  );
}
