import type { AttributeSpec } from '@core/notation';
import { Button, Select } from '@headlessui/react';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-python';
import 'prismjs/themes/prism.css';
import { t } from '@modeler/i18n';
import { ICONS } from '@modeler/icons';
import { useInspectedModel } from '@modeler/inspector/hooks';
import { readAttribute } from '@core/model/index';
import { executeCommand } from '@modeler/commandBus';
import { useAttributeState } from '@modeler/inspector/hooks';
import { parseSchemaBody, type SchemaColumn, type SchemaFormat } from '@core/document';
import { DATATYPES, editedFormat, serialize } from '@modeler/inspector/schemaFormats';
import { codeEditor as s } from '@modeler/inspector/styles';

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
  const model = useInspectedModel();
  const languageAttr: string | undefined = attrDef.meta?.languageAttr;
  const [modalOpen, setModalOpen] = useState(false);
  const [modalValue, setModalValue] = useState(value);
  const [modalLanguage, setModalLanguage] = useState('');

  function showEditorModal() {
    setModalValue(value);
    setModalLanguage(languageAttr ? String(readAttribute(model, element, languageAttr) ?? '') : '');
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
  }

  function saveModal() {
    // The code and its language are one save, so one undo takes back both.
    if (languageAttr) executeCommand(modeler, { type: 'UpdateAttributes', element, values: { [attributeName]: modalValue, [languageAttr]: modalLanguage } });
    else commit(modalValue);
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
  monoInput: 'w-full bg-transparent focus:outline-none font-mono text-xs',
  moveBtn: 'text-stone-500 hover:text-stone-900 disabled:opacity-30 px-1',
  formatRadio: 'flex items-center gap-1.5',
};

/** A schema's body: its columns in a table, in the format its `format` attribute names, or text when the table cannot hold it. */
export function SchemaEditor({ attrDef }: { attrDef: AttributeSpec }) {
  const { value, element } = useAttributeState<string>(attrDef, (raw) => raw || '');
  const model = useInspectedModel();
  const format = editedFormat(model.attribute(element, 'format'), value);
  if (format) return <ColumnEditor attrDef={attrDef} edited={format} />;
  return (
    <>
      <p className="mt-1 px-1 text-[0.6875rem]/4 text-stone-600">
        The column editor edits a CSVW or LinkML schema written in place; this one is edited as text.
      </p>
      <CodeEditor attrDef={attrDef} />
    </>
  );
}

function ColumnEditor({ attrDef, edited }: { attrDef: AttributeSpec; edited: SchemaFormat }) {
  const { value, attributeName, element, modeler } = useAttributeState<string>(attrDef, (raw) => raw || '');
  const [modalOpen, setModalOpen] = useState(false);
  const [columns, setColumns] = useState<SchemaColumn[]>([]);
  const [format, setFormat] = useState<SchemaFormat>(edited);
  const [showSource, setShowSource] = useState(false);

  function open() {
    setColumns(parseSchemaBody(value).columns);
    setFormat(edited);
    setShowSource(false);
    setModalOpen(true);
  }
  function close() { setModalOpen(false); }
  function save() {
    executeCommand(modeler, { type: 'UpdateAttributes', element, values: { format, body: serialize(columns, format) } });
    setModalOpen(false);
  }

  function updateColumn(idx: number, patch: Partial<SchemaColumn>) {
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
              <pre className="bg-stone-50 border border-black/[0.06] rounded p-3 text-[0.6875rem] overflow-auto">
                {sourcePreview}
              </pre>
            ) : (
              <div className="overflow-x-auto border border-black/[0.06] rounded">
                <table className="w-full text-sm">
                <thead>
                  <tr className="bg-stone-50 text-left text-[0.6875rem] uppercase tracking-wide text-stone-500">
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
                      <td colSpan={6} className="px-2 py-4 text-center text-stone-500 italic">
                        No columns yet. Click "Add column" to begin.
                      </td>
                    </tr>
                  ) : (
                    columns.map((c, idx) => (
                      <tr key={idx} className="border-t border-black/[0.04]">
                        <td className="px-2 py-1.5 text-stone-500 text-xs text-center">{idx + 1}</td>
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
                            className="w-full bg-transparent focus:outline-none text-xs"
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
                            className="text-stone-500 hover:text-red-700 px-1"
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
