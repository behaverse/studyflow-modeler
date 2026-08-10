import type { AttributeSpec } from '@/core/notation';
import { Button, Select } from '@headlessui/react';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-python';
import 'prismjs/themes/prism.css';
import { t } from '@/i18n';
import { ICONS } from '@/icons';
import { getAttribute } from '@/core/element';
import { executeCommand } from '@/modeler/commandBus';
import { useAttributeState } from '@/modeler/inspector/state';
import { DATATYPES, parseBody, serialize, type Column, type SourceFormat } from '@/modeler/inspector/schemaFormats';
import { codeEditor as s } from '@/modeler/inspector/styles';

const SCRIPT_LANGUAGES = [
  { value: '', label: 'Engine default' },
  { value: 'python', label: 'Python' },
  { value: 'javascript', label: 'JavaScript' },
];

const GRAMMARS: Record<string, any> = {
  yaml: Prism.languages.yaml,
  python: Prism.languages.python,
  javascript: Prism.languages.javascript,
};

function highlight(code: string, language: string): string {
  const grammar = GRAMMARS[language];
  if (grammar) return Prism.highlight(code, grammar, language);
  return code.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

export function CodeEditor({ attrDef }: { attrDef: AttributeSpec }) {
  const { value, commit, attributeName, element, modeler } = useAttributeState<string>(attrDef, (raw) => raw || '');
  const languageAttr: string | undefined = attrDef.meta?.languageAttr;
  const [modalOpen, setModalOpen] = useState(false);
  const [modalValue, setModalValue] = useState(value);
  const [modalLanguage, setModalLanguage] = useState('');

  function showEditorModal() {
    setModalValue(value);
    setModalLanguage(languageAttr ? String(getAttribute(element, languageAttr) ?? '') : '');
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
  }

  function saveModal() {
    commit(modalValue);
    if (languageAttr && modalLanguage !== String(getAttribute(element, languageAttr) ?? '')) {
      executeCommand(modeler, {
        type: 'UpdateAttribute', element, attributeName: languageAttr, value: modalLanguage || undefined,
      });
    }
    setModalOpen(false);
  }

  const highlightLanguage = languageAttr ? modalLanguage : 'yaml';

  const modal = (
    <div className={s.modalOverlay}>
      <div className={s.modalBackdrop} onClick={closeModal} />
      <div role="dialog" aria-modal="true" className={s.modal}>
        <div className={s.modalHeader}>
          <h3 className={s.modalTitle}>Edit {t(attributeName)}</h3>
          <button className={s.modalClose} onClick={closeModal}>
            <i className={`${ICONS.close} cursor-pointer`}></i>
          </button>
        </div>
        <div className={s.modalBody}>
          <div className={s.modalSection}>
            <label className={s.modalSubLabel}>Language</label>
            {languageAttr ? (
              <Select
                value={modalLanguage}
                onChange={(e) => setModalLanguage(e.target.value)}
                className={s.modalLanguageSelect}
              >
                {SCRIPT_LANGUAGES.map((lang) => (
                  <option key={lang.value} value={lang.value}>{lang.label}</option>
                ))}
              </Select>
            ) : (
              <Select value="YAML" disabled className={s.modalLanguageSelect}>
                <option value="YAML">YAML</option>
              </Select>
            )}
          </div>
          <div className={s.modalSectionGrow}>
            <label className={s.modalSubLabel}>Body</label>
            <div className={s.modalEditorFrame}>
              <Editor
                value={modalValue}
                onValueChange={setModalValue}
                highlight={(code) => highlight(code, highlightLanguage)}
                padding={{ top: 6, right: 12, bottom: 6, left: 12 }}
                textareaClassName="focus:outline-none"
                className={s.modalEditor}
              />
            </div>
          </div>
        </div>
        <div className={s.modalActions}>
          <Button className={s.modalCancelBtn} onClick={closeModal}>Cancel</Button>
          <Button className={s.modalSaveBtn} onClick={saveModal}>Save</Button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <Button className={s.openButton} onClick={showEditorModal}>
        <i className={`${ICONS.pencil} pe-2`}></i> Edit {t(attributeName)}
      </Button>
      {modalOpen && createPortal(modal, document.body)}
    </>
  );
}

const cn = {
  cell: 'px-2 py-1.5',
  monoInput: 'w-full bg-transparent focus:outline-none font-mono text-[12px]',
  moveBtn: 'text-stone-400 hover:text-stone-900 disabled:opacity-30 px-1',
  formatRadio: 'flex items-center gap-1.5',
};

export function SchemaEditor({ attrDef }: { attrDef: AttributeSpec }) {
  const { value, commit, attributeName } = useAttributeState<string>(attrDef, (raw) => raw || '');
  const [session, setSession] = useState<number | null>(null);
  const parsed = useMemo(() => parseBody(value), [value]);
  const [columns, setColumns] = useState<Column[]>(parsed.columns);
  const [format, setFormat] = useState<SourceFormat>(parsed.format);
  const [showSource, setShowSource] = useState(false);

  const modalOpen = session !== null;

  // Each open is a counter-keyed session: the draft re-seeds at open time only, since `value` changing mid-session is the user's own commit echoing back.
  const [seededFor, setSeededFor] = useState<number | null>(null);
  if (modalOpen && seededFor !== session) {
    setSeededFor(session);
    setColumns(parsed.columns);
    setFormat(parsed.format);
    setShowSource(parsed.unparseable === true);
  }

  function open() { setSession((n) => (n ?? 0) + 1); }
  function close() { setSession(null); }
  function save() {
    commit(serialize(columns, format));
    setSession(null);
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

            {parsed.unparseable && (
              <p
                data-testid="schema-unparseable"
                className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2"
                role="alert"
              >
                This schema is neither CSVW JSON-LD nor LinkML YAML, so the table
                below cannot represent it. Saving would replace it — edit the
                source directly instead.
              </p>
            )}

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
          {/* Disabled while unparseable: saving would serialize an empty column list over a schema this editor merely failed to read. */}
          <Button className={s.modalSaveBtn} onClick={save} disabled={parsed.unparseable}>Save</Button>
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
