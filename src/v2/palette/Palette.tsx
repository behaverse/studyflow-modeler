import { useState, useCallback, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { useModelerStore } from '../store';
import { SCHEMA_NAMES } from '../../shared/constants';
import { SchemaPopupMenu } from './SchemaPopupMenu';

type PaletteEntry = {
  key: string;
  label: string;
  bpmnType: string;
  studyflowType?: string;
  icon: string;
  title: string;
};

const PALETTE_ENTRIES: PaletteEntry[] = [
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
  },
];

const CORE_PREFIXES = new Set(['bpmn', 'bpmndi', 'dc', 'di', 'bioc', 'color']);
const schemaOrder = new Map(SCHEMA_NAMES.map((name, i) => [name, i]));

function renderSchemaIcon(icon?: string) {
  if (icon && /^(https?:\/\/|data:image\/)/i.test(icon)) {
    return <img src={icon} alt="" className="h-6 w-6 object-contain" loading="lazy" decoding="async" />;
  }
  return <i className={`text-[24px] ${icon || 'iconify tabler--hexagon'}`} />;
}

interface SchemaDescriptor {
  prefix: string;
  icon?: string;
}

export function Palette({ className = '' }: { className?: string }) {
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const [popup, setPopup] = useState<{ prefix: string; icon?: string; x: number; y: number } | null>(null);
  const doc = useModelerStore((s) => s.document);

  // Discover extension schemas from the loaded moddle packages
  const schemas: SchemaDescriptor[] = [];
  if (doc) {
    const moddle = doc.getModdle();
    const packageMap = moddle.registry?.packageMap ?? {};
    const seen = new Set<string>();
    for (const [, pkg] of Object.entries(packageMap) as [string, any][]) {
      const prefix = pkg.prefix?.toLowerCase();
      if (!prefix || CORE_PREFIXES.has(prefix) || seen.has(prefix)) continue;
      seen.add(prefix);
      schemas.push({ prefix, icon: typeof pkg.icon === 'string' ? pkg.icon : undefined });
    }
    schemas.sort((a, b) => {
      const ai = schemaOrder.get(a.prefix) ?? Number.MAX_SAFE_INTEGER;
      const bi = schemaOrder.get(b.prefix) ?? Number.MAX_SAFE_INTEGER;
      return ai !== bi ? ai - bi : a.prefix.localeCompare(b.prefix);
    });
  }

  const onDragStart = (entry: PaletteEntry, event: DragEvent) => {
    event.dataTransfer.setData('application/bpmn-type', entry.bpmnType);
    if (entry.studyflowType) {
      event.dataTransfer.setData('application/studyflow-type', entry.studyflowType);
    }
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleSchemaClick = useCallback((prefix: string, icon: string | undefined, event: ReactMouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setPopup({
      prefix,
      icon,
      x: rect.right + 10,
      y: rect.top,
    });
  }, []);

  return (
    <>
      <div
        className={`fixed top-20 left-2 z-2 flex flex-col ${className}`}
        data-testid="palette-root"
      >
        {/* Core BPMN entries */}
        {PALETTE_ENTRIES.map((entry) => (
          <div key={entry.key} className="group mb-2 flex items-center gap-2">
            <button
              type="button"
              title={entry.title}
              className="flex palette-button"
              draggable
              onDragStart={(e) => onDragStart(entry, e as unknown as DragEvent)}
              onMouseDown={() => setPressedKey(entry.key)}
              onMouseUp={() => setPressedKey(null)}
              onMouseLeave={() => setPressedKey(null)}
            >
              <i className={`text-[24px] ${entry.icon}`} />
            </button>
            <span
              className={`text-sm text-violet-700 whitespace-nowrap ${
                pressedKey ? 'hidden' : 'hidden group-hover:inline-block'
              }`}
            >
              {entry.label}
            </span>
          </div>
        ))}

        {/* Separator + schema and tool buttons */}
        <div className="mt-3 flex flex-col gap-1">
          {/* Schema-specific popup buttons */}
          {schemas.map(({ prefix, icon }) => (
            <div key={`more-${prefix}`} className="group flex items-center gap-2">
              <button
                type="button"
                title={`More ${prefix} elements...`}
                className="flex palette-button-tool"
                onClick={(e) => handleSchemaClick(prefix, icon, e)}
              >
                {renderSchemaIcon(icon)}
              </button>
              <span
                className={`text-sm text-violet-700 whitespace-nowrap ${
                  pressedKey ? 'hidden' : 'hidden group-hover:inline-block'
                }`}
              >
                {prefix} elements...
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Schema popup menu */}
      {popup && (
        <SchemaPopupMenu
          prefix={popup.prefix}
          icon={popup.icon}
          position={{ x: popup.x, y: popup.y }}
          onClose={() => setPopup(null)}
        />
      )}
    </>
  );
}
