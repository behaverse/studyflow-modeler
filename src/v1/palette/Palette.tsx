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
        icon: type.icon || `sfi-${type.name}`,
        title: type.description || `Create ${type.name}`,
      };
    });
}

function loadBpmnEntries(): PaletteEntry[] {
  return [
    {
      key: 'bpmn:StartEvent',
      label: 'bpmn:StartEvent',
      type: 'bpmn:StartEvent',
      icon: 'iconify bpmn--start-event-none',
      title: 'Create Start Event',
    },
    {
      key: 'bpmn:EndEvent',
      label: 'bpmn:EndEvent',
      type: 'bpmn:EndEvent',
      icon: 'iconify bpmn--end-event-none',
      title: 'Create End Event',
    },
    {
      key: 'bpmn:Task',
      label: 'bpmn:Task',
      type: 'bpmn:Task',
      icon: 'iconify bpmn--task-none',
      title: 'Create Task',
    },
  ];
}

export function Palette({ className = '' }: { className?: string }) {
  const { modeler } = useContext(ModelerContext);
  const [entries, setEntries] = useState<PaletteEntry[]>([]);
  const mouseDownRef = useRef(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!modeler) return;
    setEntries([...loadBpmnEntries(), ...loadStudyflowEntries(modeler)]);
  }, [modeler]);

  const handleClick = (entry: PaletteEntry, event: ReactMouseEvent) => {
    if (!modeler) return;
    event.preventDefault();
    // If drag path already started, just reset flags.
    if (startedRef.current) {
      startedRef.current = false;
      mouseDownRef.current = false;
      return;
    }
    // Click-to-pick: start create; user will click canvas to drop.
    startCreate(modeler, entry.type, event.nativeEvent);
  };

  const handleMouseDown = (entry: PaletteEntry, event: ReactMouseEvent) => {
    mouseDownRef.current = true;
    startedRef.current = false;
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
  };

  const paletteEntries = useMemo(() => entries, [entries]);

  return (
    <div className={`fixed top-20 left-4 z-2 flex flex-col ${className}`}>
      {!modeler && <div className="text-xs text-gray-500">Modeler not ready…</div>}
      {modeler && paletteEntries.length === 0 && (
        <div className="text-xs text-gray-500">No studyflow elements available.</div>
      )}
      {paletteEntries.map((entry) => (
        <div
          key={entry.key}
          className="group mb-2 flex items-center gap-1"
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
            <i className={`text-[24px] leading-none ${entry.icon ?? ''}`}></i>
          </button>
          <span className="hidden text-sm text-stone-500 whitespace-nowrap group-hover:inline-block">{entry.label}</span>
        </div>
      ))}
    </div>
  );
}