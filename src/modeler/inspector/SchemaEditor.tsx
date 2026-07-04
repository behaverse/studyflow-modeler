import { Button } from '@headlessui/react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../i18n';
import { useAttributeState } from './hooks/useAttributeState';
import { DATATYPES, parseBody, serialize, type Column, type SourceFormat } from './schemaFormats';
import { codeEditor as s } from '../styles';
import { ICONS } from '@/icons';

/** Repeated Tailwind class strings, hoisted so each lives in one place. */
const cn = {
  cell: 'px-2 py-1.5',
  monoInput: 'w-full bg-transparent focus:outline-none font-mono text-[12px]',
  moveBtn: 'text-stone-400 hover:text-stone-900 disabled:opacity-30 px-1',
  formatRadio: 'flex items-center gap-1.5',
};

/**
 * Tabular editor for a Schema element's `body` attribute. Replaces the raw
 * YAML/JSON-LD CodeEditor with a column-oriented grid: rows = columns of the
 * tabular dataset, fields = name / datatype / description / required.
 *
 * On save, serializes back to the source format (CSVW JSON-LD by default;
 * LinkML YAML if the body was originally LinkML) via `schemaFormats.ts`.
 * A "View source" toggle shows the underlying text so the round-trip stays
 * transparent.
 */

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
          <h3 className={s.modalTitle}>Edit columns; {t(attributeName)}</h3>
          <button className={s.modalClose} onClick={close}>
            <i className={`${ICONS.close} cursor-pointer`}></i>
          </button>
        </div>

        <div className={s.modalBody}>
          <div className={s.modalSection}>
            <div className="flex items-center justify-between gap-3 pb-2">
              <div className="flex items-center gap-3 text-sm">
                <label className={cn.formatRadio}>
                  <input
                    type="radio"
                    name="schema-format"
                    value="csvw"
                    checked={format === 'csvw'}
                    onChange={() => setFormat('csvw')}
                  />
                  CSVW JSON-LD
                </label>
                <label className={cn.formatRadio}>
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
                    <th className={cn.cell}>Name</th>
                    <th className="px-2 py-1.5 w-32">Datatype</th>
                    <th className={cn.cell}>Description</th>
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
                        <td className={cn.cell}>
                          <input
                            type="text"
                            value={c.name}
                            onChange={(e) => updateColumn(idx, { name: e.target.value })}
                            className={cn.monoInput}
                            placeholder="column_name"
                          />
                        </td>
                        <td className={cn.cell}>
                          <select
                            value={c.datatype}
                            onChange={(e) => updateColumn(idx, { datatype: e.target.value })}
                            className={cn.monoInput}
                          >
                            {!DATATYPES.includes(c.datatype) && <option value={c.datatype}>{c.datatype}</option>}
                            {DATATYPES.map((dt) => (
                              <option key={dt} value={dt}>{dt}</option>
                            ))}
                          </select>
                        </td>
                        <td className={cn.cell}>
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
                            className={cn.moveBtn}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => moveColumn(idx, 1)}
                            disabled={idx === columns.length - 1}
                            title="Move down"
                            className={cn.moveBtn}
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
        <i className={`${ICONS.table} pe-2`}></i> Edit columns
      </Button>
      {modalOpen && createPortal(modal, document.body)}
    </>
  );
}
