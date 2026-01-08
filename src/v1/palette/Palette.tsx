import { useContext, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { ModelerContext } from '../contexts';
import { startCreate } from './createShape';

type PaletteEntry = {
  key: string;
  label: string;
  type: string;
  icon?: string;
  title?: string;
};

function loadStudyflowEntries(modeler: any): PaletteEntry[] {
  const bpmnFactory = modeler.get('bpmnFactory');
  const moddle = bpmnFactory._model;
  const pkg = moddle.getPackage('studyflow');

  if (!pkg?.types) {
    return [];
  }

  const primitiveTypes = ['String', 'Boolean', 'Integer', 'Float', 'Double'];

  return pkg.types
    .filter((type: any) => {
      if (type.isAbstract) return false;
      if (type.extends?.length > 0) return false;
      if (type.name === 'Study') return false;
      if (type.superClass && type.superClass.some((sc: string) => primitiveTypes.includes(sc))) {
        return false;
      }
      return true;
    })
    .map((type: any) => {
      const elementType = `studyflow:${type.name}`;
      return {
        key: elementType,
        label: type.name,
        type: elementType,
        icon: type.icon,
        title: type.description || `Create ${type.name}`,
      };
    });
}

function loadBpmnEntries(): PaletteEntry[] {
  return [
    {
      key: 'bpmn:StartEvent',
      label: 'Start',
      type: 'bpmn:StartEvent',
      icon: 'iconify bpmn--start-event-none',
      title: 'Create Start Event',
    },
    {
      key: 'bpmn:EndEvent',
      label: 'End',
      type: 'bpmn:EndEvent',
      icon: 'iconify bpmn--end-event-none',
      title: 'Create End Event',
    },
    {
      key: 'bpmn:Task',
      label: 'Task',
      type: 'bpmn:Task',
      icon: 'iconify bpmn--task-none',
      title: 'Create Task',
    },
  ];
}

export function Palette({ className = '' }: { className?: string }) {
  const { modeler } = useContext(ModelerContext);
  const [entries, setEntries] = useState<PaletteEntry[]>([]);
  const [pressedEntryKey, setPressedEntryKey] = useState<string | null>(null);
  const mouseDownRef = useRef(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!modeler) return;
    setEntries([...loadBpmnEntries(), ...loadStudyflowEntries(modeler)]);
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
    startCreate(modeler, entry.type, event.nativeEvent);
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
    startCreate(modeler, entry.type, event.nativeEvent);
  };

  const handleMouseUp = () => {
    mouseDownRef.current = false;
    setPressedEntryKey(null);
  };

  const paletteEntries = useMemo(() => entries, [entries]);

  return (
    <div className={`fixed top-32 left-4 z-2 flex flex-col ${className}`}>
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
      <div
        key="more"
        className="group mb-2 flex items-center gap-2"
      >
        <button
          type="button"
          title="More elements..."
          className="flex palette-button-more"
          onMouseDown={(e) => { }}
          onMouseMove={(e) => { }}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={(e) => { }}
        >
          <i className={`text-[32px] iconify bi--three-dots`}></i>
        </button>
        <span
          className={`text-sm text-violet-700 whitespace-nowrap ${
            pressedEntryKey ? 'hidden' : 'hidden group-hover:inline-block'
          }`}
        >
          More elements...
        </span>
      </div>
    </div>
  );
}