import React, { useContext, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { ModelerContext } from '../contexts';
import { executeCommand } from '../commands';
import type { PaletteSchemaDescriptor } from '../commands/paletteSetup';
import { t } from '../../i18n';

type PaletteEntry = {
  label: string;
  bpmnType: string;
  studyflowType?: string;
  icon?: string;
};

type PaletteGroup = {
  label: string;
  icon: string;
  items: PaletteEntry[];
};

// default BPMN elements for palette, can be extended by schemas
const PALETTE_GROUPS: PaletteGroup[] = [
  {
    label: 'Events',
    icon: 'iconify fluent--circle-16-regular',
    items: [
      { label: 'Start', bpmnType: 'bpmn:StartEvent', studyflowType: 'studyflow:StartEvent', icon: 'iconify bpmn--start-event-none' },
      { label: 'Intermediate', bpmnType: 'bpmn:IntermediateThrowEvent', icon: 'iconify bpmn--intermediate-event-none' },
      { label: 'End', bpmnType: 'bpmn:EndEvent', studyflowType: 'studyflow:EndEvent', icon: 'iconify bpmn--end-event-none' },
    ],
  },
  {
    label: 'Activities',
    icon: 'iconify fluent--rectangle-landscape-16-regular',
    items: [
      { label: 'Task', bpmnType: 'bpmn:Task', icon: 'iconify bpmn--task-none' },
      { label: 'User', bpmnType: 'bpmn:UserTask', icon: 'iconify bpmn--user-task' },
      { label: 'Script', bpmnType: 'bpmn:ScriptTask', icon: 'iconify bpmn--script-task' },
      { label: 'Service', bpmnType: 'bpmn:ServiceTask', icon: 'iconify bpmn--service-task' },
      { label: 'Manual', bpmnType: 'bpmn:ManualTask', icon: 'iconify bpmn--manual-task' }
    ],
  },
  {
    label: 'Gateways',
    icon: 'iconify fluent--diamond-16-regular',
    items: [
      { label: 'Exclusive', bpmnType: 'bpmn:ExclusiveGateway', icon: 'iconify bpmn--gateway-xor' },
      { label: 'Parallel', bpmnType: 'bpmn:ParallelGateway', icon: 'iconify bpmn--gateway-parallel' },
      { label: 'Inclusive', bpmnType: 'bpmn:InclusiveGateway', icon: 'iconify bpmn--gateway-or' },
      { label: 'Complex', bpmnType: 'bpmn:ComplexGateway', icon: 'iconify bpmn--gateway-complex' },
      { label: 'Event', bpmnType: 'bpmn:EventBasedGateway', icon: 'iconify bpmn--gateway-eventbased' },
    ],
  },
  {
    label: 'Data',
    icon: 'iconify mynaui--database',
    items: [
      { label: 'Data Object', bpmnType: 'bpmn:DataObjectReference', icon: 'iconify bpmn--data-object' }
    ],
  },
  {
    label: 'Containers',
    icon: 'iconify mynaui--square-dashed',
    items: [
      { label: 'Group', bpmnType: 'bpmn:Group', icon: 'iconify bpmn--group' },
      { label: 'Sub-Process', bpmnType: 'bpmn:SubProcess', icon: 'iconify bpmn--subprocess-collapsed' },
      { label: 'Pool', bpmnType: 'bpmn:Participant', icon: 'iconify bpmn--participant' }

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
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const mouseDownRef = useRef(false);
  const startedRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const registeredSchemasRef = useRef<Set<string>>(new Set());
  const lastModelerRef = useRef<any>(null);

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
    setOpenGroup(null);
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
                     rounded-r-xl bg-stone-800/90 backdrop-blur-2xl
                     border border-white/10 border-l-0
                     shadow-[2px_0_10px_rgba(0,0,0,0.20),6px_0_28px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.08)]
                     py-1.5 px-1 gap-0.5
                     ${className}`} data-testid="palette-root" ref={rootRef}>
        <div key="lasso" className="group relative flex items-center" onMouseEnter={() => setOpenGroup(null)}>
          <button
            type="button"
            title="Select elements with lasso tool"
            className="palette-tool-btn"
            onClick={handleLassoToolClick}
          >
            <i className="text-[22px] iconify material-symbols--ink-selection-rounded"></i>
          </button>
          <span className="palette-tooltip">Select multiple elements</span>
        </div>
      {PALETTE_GROUPS.map((group) => {
        const isOpen = openGroup === group.label;
        const extraItems = schemas.flatMap((schema) =>
          schema.items.filter((item) => item.categories[0] === group.label)
        );
        return (
        <div key={group.label} className="group/palgroup relative flex items-center"
             onMouseEnter={() => { if (openGroup && openGroup !== group.label) setOpenGroup(null); }}>
            <button
              type="button"
              title={group.label}
              className="palette-tool-btn relative"
              aria-expanded={isOpen}
              onClick={(e) => {
                e.preventDefault();
                setOpenGroup(isOpen ? null : group.label);
              }}
            >
              <i className={`text-[22px] ${group.icon}`}></i>
              <span className="absolute right-[3px] top-1/2 w-[3px] h-[3px] border-r-[1.4px] border-b-[1.4px] border-stone-200 rotate-[-45deg] -translate-y-1/2" />
            </button>

            {/* Flyout */}
            <div className={`${isOpen ? 'visible opacity-100 pointer-events-auto' : 'invisible opacity-0 pointer-events-none'}
                            group-hover/palgroup:visible group-hover/palgroup:opacity-100 group-hover/palgroup:pointer-events-auto
                            transition-all duration-150
                            absolute left-[calc(100%+10px)] top-[-6px] z-[300]
                            w-[220px] p-2.5 pb-3
                            rounded-[14px] bg-stone-900/92 backdrop-blur-2xl
                            border border-white/10
                            shadow-[0_4px_12px_rgba(0,0,0,0.25),0_8px_32px_rgba(0,0,0,0.30),inset_0_1px_0_rgba(255,255,255,0.08)]`}>
              {/* Gap bridge so hover stays active between button and flyout */}
              <span className="absolute left-[-10px] top-0 w-[10px] h-full" aria-hidden="true" />

              <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-stone-400
                              pb-2 mb-2 px-1 border-b border-white/10">
                {group.label}
              </div>
              <div className="grid grid-cols-3 gap-1">
                {[...group.items, ...extraItems].map((item) => {
                  const key = item.studyflowType ?? item.bpmnType;
                  const isUrlIcon = !!item.icon && /^(https?:\/\/|data:image\/)/i.test(item.icon);
                  return (
                  <button
                    key={key}
                    type="button"
                    title={`Create ${item.label}`}
                    className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg
                               text-stone-200 hover:text-violet-400 hover:bg-white/10
                               transition-colors cursor-grab active:cursor-grabbing"
                    onMouseDown={(e) => handleMouseDown(item, e)}
                    onMouseMove={(e) => handleMouseMove(item, e)}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    onClick={(e) => handleClick(item, e)}
                  >
                    {isUrlIcon ? (
                      <img src={item.icon} alt="" className="h-[22px] w-[22px] object-contain" loading="lazy" decoding="async" />
                    ) : (
                      <i className={`text-[22px] ${item.icon || 'iconify tabler--hexagon'}`}></i>
                    )}
                    <span className="text-[9.5px] font-semibold leading-tight text-center">
                      {item.label}
                    </span>
                  </button>
                  );
                })}
              </div>
            </div>
        </div>
        );
      })}

      <div className="my-1 h-px bg-white/10 mx-1" />

        {schemas.map(({ prefix, icon }) => (
          <div key={`more-${prefix}`} className="group relative flex items-center" onMouseEnter={() => setOpenGroup(null)}>
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
              <span className="absolute right-[3px] top-1/2 w-[3px] h-[3px] border-r-[1.4px] border-b-[1.4px] border-stone-200 rotate-[-45deg] -translate-y-1/2" />
          </div>
        ))}
        <div key="more-bpmn" className="group relative flex items-center" onMouseEnter={() => setOpenGroup(null)}>
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
  );
}
