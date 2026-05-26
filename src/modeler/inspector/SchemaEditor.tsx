import { Button } from '@headlessui/react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import * as yaml from 'js-yaml';
import { t } from '../../i18n';
import { useAttributeState } from './hooks/useAttributeState';
import { codeEditor as s } from '../styles';

/**
 * Tabular editor for a Schema element's `body` attribute. Replaces the raw
 * YAML/JSON-LD CodeEditor with a column-oriented grid: rows = columns of the
 * tabular dataset, fields = name / datatype / description / required.
 *
 * On save, serializes back to the source format (CSVW JSON-LD by default;
 * LinkML YAML if the body was originally LinkML). A "View source" toggle
 * shows the underlying text so the round-trip stays transparent.
 */

type Column = {
  name: string;
  datatype: string;
  description: string;
  required: boolean;
};

type SourceFormat = 'csvw' | 'linkml';

const DATATYPES = [
  'string',
  'integer',
  'number',
  'boolean',
  'date',
  'dateTime',
  'duration',
  'anyURI',
];

/** Best-effort parse of CSVW JSON-LD or LinkML YAML into a column list. */
function parseBody(body: string): { columns: Column[]; format: SourceFormat } {
  if (!body || !body.trim()) return { columns: [], format: 'csvw' };

  // Try JSON-LD first.
  try {
    const json = JSON.parse(body);
    const cols = json.tableSchema?.columns ?? json.columns ?? [];
    if (Array.isArray(cols)) {
      return {
        columns: cols.map((c: any) => ({
          name: c.name ?? '',
          datatype: typeof c.datatype === 'string' ? c.datatype : c.datatype?.base ?? 'string',
          description: c['dc:description'] ?? c.description ?? '',
          required: c.required === true,
        })),
        format: 'csvw',
      };
    }
  } catch {
    // Not JSON; fall through to YAML.
  }

  // Try LinkML YAML.
  try {
    const doc: any = yaml.load(body);
    if (doc && typeof doc === 'object') {
      // Single class with attributes, or a `classes:` block where each class has attributes.
      const classes = doc.classes ?? (doc.attributes ? { Root: doc } : null);
      if (classes) {
        const firstClassName = Object.keys(classes)[0];
        const cls = classes[firstClassName];
        const attrs = cls?.attributes ?? {};
        return {
          columns: Object.entries(attrs).map(([name, def]: [string, any]) => ({
            name,
            datatype: def?.range ?? 'string',
            description: def?.description ?? '',
            required: def?.required === true,
          })),
          format: 'linkml',
        };
      }
    }
  } catch {
    // Not parseable; return empty.
  }

  return { columns: [], format: 'csvw' };
}

function serializeCsvw(columns: Column[]): string {
  const doc = {
    '@context': 'http://www.w3.org/ns/csvw',
    tableSchema: {
      columns: columns.map((c) => {
        const out: Record<string, unknown> = { name: c.name, datatype: c.datatype };
        if (c.description) out['dc:description'] = c.description;
        if (c.required) out.required = true;
        return out;
      }),
    },
  };
  return JSON.stringify(doc, null, 2);
}

function serializeLinkml(columns: Column[]): string {
  const attrs: Record<string, any> = {};
  for (const c of columns) {
    const def: Record<string, unknown> = { range: c.datatype || 'string' };
    if (c.description) def.description = c.description;
    if (c.required) def.required = true;
    attrs[c.name || `column_${Object.keys(attrs).length}`] = def;
  }
  return yaml.dump({ classes: { TableRow: { attributes: attrs } } }, { lineWidth: 100 });
}

function serialize(columns: Column[], format: SourceFormat): string {
  return format === 'linkml' ? serializeLinkml(columns) : serializeCsvw(columns);
}

export function SchemaEditor({ attrDef }: { attrDef: any }) {
  const { value, commit, attributeName } = useAttributeState<string>(attrDef, (raw) => raw || '');
  const [modalOpen, setModalOpen] = useState(false);
  const initial = useMemo(() => parseBody(value), [value]);
  const [columns, setColumns] = useState<Column[]>(initial.columns);
  const [format, setFormat] = useState<SourceFormat>(initial.format);
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    if (modalOpen) {
      const parsed = parseBody(value);
      setColumns(parsed.columns);
      setFormat(parsed.format);
      setShowSource(false);
    }
  }, [modalOpen, value]);

  function open() { setModalOpen(true); }
  function close() { setModalOpen(false); }
  function save() {
    commit(serialize(columns, format));
    setModalOpen(false);
  }

  function updateColumn(idx: number, patch: Partial<Column>) {
    setColumns((cs) => cs.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }
  function addColumn() {
    setColumns((cs) => [...cs, { name: '', datatype: 'string', description: '', required: false }]);
  }
  function removeColumn(idx: number) {
    setColumns((cs) => cs.filter((_, i) => i !== idx));
  }
  function moveColumn(idx: number, delta: number) {
    setColumns((cs) => {
      const next = [...cs];
      const target = idx + delta;
      if (target < 0 || target >= next.length) return cs;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  const sourcePreview = useMemo(() => serialize(columns, format), [columns, format]);

  const modal = (
    <div className={s.modalOverlay}>
      <div className={s.modalBackdrop} onClick={close} />
      <div role="dialog" aria-modal="true" className={s.modal}>
        <div className={s.modalHeader}>
          <h3 className={s.modalTitle}>Edit columns — {t(attributeName)}</h3>
          <button className={s.modalClose} onClick={close}>
            <i className="iconify bi--x-lg cursor-pointer"></i>
          </button>
        </div>

        <div className={s.modalBody}>
          <div className={s.modalSection}>
            <div className="flex items-center justify-between gap-3 pb-2">
              <div className="flex items-center gap-3 text-sm">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="schema-format"
                    value="csvw"
                    checked={format === 'csvw'}
                    onChange={() => setFormat('csvw')}
                  />
                  CSVW JSON-LD
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="schema-format"
                    value="linkml"
                    checked={format === 'linkml'}
                    onChange={() => setFormat('linkml')}
                  />
                  LinkML YAML
                </label>
              </div>
              <button
                type="button"
                className="text-xs text-stone-500 hover:text-stone-900"
                onClick={() => setShowSource((v) => !v)}
              >
                {showSource ? 'Hide source' : 'View source'}
              </button>
            </div>

            {showSource ? (
              <pre className="bg-stone-50 border border-black/[0.06] rounded p-3 text-[11px] overflow-auto">
                {sourcePreview}
              </pre>
            ) : (
              <div className="overflow-x-auto border border-black/[0.06] rounded">
                <table className="w-full text-sm">
                <thead>
                  <tr className="bg-stone-50 text-left text-[11px] uppercase tracking-wide text-stone-500">
                    <th className="px-2 py-1.5 w-8"></th>
                    <th className="px-2 py-1.5">Name</th>
                    <th className="px-2 py-1.5 w-32">Datatype</th>
                    <th className="px-2 py-1.5">Description</th>
                    <th className="px-2 py-1.5 w-14">Req.</th>
                    <th className="px-2 py-1.5 w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {columns.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-2 py-4 text-center text-stone-400 italic">
                        No columns yet. Click "Add column" to begin.
                      </td>
                    </tr>
                  ) : (
                    columns.map((c, idx) => (
                      <tr key={idx} className="border-t border-black/[0.04]">
                        <td className="px-2 py-1.5 text-stone-400 text-xs text-center">{idx + 1}</td>
                        <td className="px-2 py-1.5">
                          <input
                            type="text"
                            value={c.name}
                            onChange={(e) => updateColumn(idx, { name: e.target.value })}
                            className="w-full bg-transparent focus:outline-none font-mono text-[12px]"
                            placeholder="column_name"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <select
                            value={c.datatype}
                            onChange={(e) => updateColumn(idx, { datatype: e.target.value })}
                            className="w-full bg-transparent focus:outline-none font-mono text-[12px]"
                          >
                            {!DATATYPES.includes(c.datatype) && <option value={c.datatype}>{c.datatype}</option>}
                            {DATATYPES.map((dt) => (
                              <option key={dt} value={dt}>{dt}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="text"
                            value={c.description}
                            onChange={(e) => updateColumn(idx, { description: e.target.value })}
                            className="w-full bg-transparent focus:outline-none text-[12px]"
                            placeholder="(optional)"
                          />
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={c.required}
                            onChange={(e) => updateColumn(idx, { required: e.target.checked })}
                          />
                        </td>
                        <td className="px-2 py-1.5 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => moveColumn(idx, -1)}
                            disabled={idx === 0}
                            title="Move up"
                            className="text-stone-400 hover:text-stone-900 disabled:opacity-30 px-1"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => moveColumn(idx, 1)}
                            disabled={idx === columns.length - 1}
                            title="Move down"
                            className="text-stone-400 hover:text-stone-900 disabled:opacity-30 px-1"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            onClick={() => removeColumn(idx)}
                            title="Remove column"
                            className="text-stone-400 hover:text-red-700 px-1"
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <div className="border-t border-black/[0.04] p-2">
                <button
                  type="button"
                  onClick={addColumn}
                  className="text-xs text-stone-600 hover:text-stone-900"
                >
                  + Add column
                </button>
              </div>
            </div>
          )}
          </div>
        </div>

        <div className={s.modalActions}>
          <Button className={s.modalCancelBtn} onClick={close}>Cancel</Button>
          <Button className={s.modalSaveBtn} onClick={save}>Save</Button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <Button className={s.openButton} onClick={open}>
        <i className="iconify bi--table pe-2"></i> Edit columns
      </Button>
      {modalOpen && createPortal(modal, document.body)}
    </>
  );
}
