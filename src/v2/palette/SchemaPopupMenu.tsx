import { useState, useRef, useEffect } from 'react';
import { useModelerStore } from '../store';
import { resolveBpmnCreateType } from '../../shared/moddle/resolveBpmnType';
import { createShapeDragImage } from './dragPreview';

interface SchemaEntry {
  typeName: string;
  label: string;
  bpmnType: string;
  icon?: string;
  description?: string;
}

interface SchemaPopupMenuProps {
  prefix: string;
  icon?: string;
  position: { x: number; y: number };
  onClose: () => void;
}

export function SchemaPopupMenu({ prefix, position, onClose }: SchemaPopupMenuProps) {
  const doc = useModelerStore((s) => s.document);
  const [search, setSearch] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  if (!doc) return null;

  const moddle = doc.getModdle();
  const typeMap = doc.getTypeMap();
  const CORE_PREFIXES = new Set(['bpmn', 'bpmndi', 'dc', 'di', 'bioc', 'color']);

  // Build entries from schema types
  const entries: SchemaEntry[] = [];
  for (const [typeName, descriptor] of Object.entries(typeMap)) {
    const typePrefix = (descriptor as any)?.ns?.prefix ?? typeName.split(':')[0];
    if (typePrefix.toLowerCase() !== prefix.toLowerCase()) continue;
    if (CORE_PREFIXES.has(typePrefix.toLowerCase())) continue;
    if ((descriptor as any)?.isAbstract) continue;

    let bpmnType: string | null;
    try {
      bpmnType = resolveBpmnCreateType(moddle, descriptor);
    } catch {
      continue;
    }
    if (!bpmnType) continue;

    const localName = typeName.includes(':') ? typeName.split(':')[1] : typeName;
    entries.push({
      typeName,
      label: localName,
      bpmnType,
      icon: (descriptor as any)?.meta?.icon || (descriptor as any)?.icon,
      description: (descriptor as any)?.description,
    });
  }

  const filtered = entries.filter((e) =>
    e.label.toLowerCase().includes(search.toLowerCase()),
  );

  const handleDragStart = (entry: SchemaEntry, e: React.DragEvent) => {
    e.dataTransfer.setData('application/bpmn-type', entry.bpmnType);
    e.dataTransfer.setData('application/studyflow-type', entry.typeName);
    e.dataTransfer.effectAllowed = 'move';
    const el = createShapeDragImage(entry.bpmnType);
    document.body.appendChild(el);
    e.dataTransfer.setDragImage(el, 0, 0);
    requestAnimationFrame(() => document.body.removeChild(el));
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-50 w-64 bg-white rounded-lg shadow-xl border border-stone-200 overflow-hidden"
      style={{ left: position.x, top: position.y }}
    >
      <div className="p-2 border-b border-stone-200">
        <input
          type="text"
          placeholder="Search elements..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-2 py-1 text-sm border border-stone-300 rounded focus:outline-none focus:border-blue-400"
          autoFocus
        />
      </div>
      <div className="max-h-64 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="px-3 py-2 text-sm text-stone-400">No elements found</div>
        )}
        {filtered.map((entry) => (
          <button
            key={entry.typeName}
            type="button"
            draggable
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-stone-100 flex items-center gap-2 cursor-grab"
            onDragStart={(e) => handleDragStart(entry, e)}
            onDragEnd={onClose}
          >
            {entry.icon && (
              /^(https?:\/\/|data:image\/)/.test(entry.icon) ? (
                <img src={entry.icon} alt="" className="w-4 h-4 object-contain" />
              ) : (
                <i className={`text-[16px] text-stone-500 ${entry.icon}`} />
              )
            )}
            <span className="text-stone-700">{entry.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
