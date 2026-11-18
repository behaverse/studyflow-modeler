import type { AttributeSpec } from '@core/notation';
import { Button, Select } from '@headlessui/react';
import { useMemo, useState } from 'react';
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
import { Modal } from '@modeler/ui/Modal';
import { dialog as d } from '@modeler/ui/styles';

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
  const languageAttr: string | undefined = attrDef.meta?.codeEditorLanguage;
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

  return (
    <>
      <Button className={s.openButton} onClick={showEditorModal}>
        <i className={ICONS.pencil} aria-hidden="true" /> Edit {t(attrDef)}
      </Button>
      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={`Edit ${t(attrDef)}`}
        size="xl"
        footer={(
          <>
            <Button className={d.secondaryBtn} onClick={closeModal}>Cancel</Button>
            <Button className={d.primaryBtn} onClick={saveModal}>Save</Button>
          </>
        )}
      >
        <div className={s.body}>
          <label className={s.label}>Language</label>
          <div className={s.selectWrapper}>
            {languageAttr ? (
              <Select value={modalLanguage} onChange={(e) => setModalLanguage(e.target.value)} className={s.select}>
                {SCRIPT_LANGUAGES.map((lang) => (
                  <option key={lang.value} value={lang.value}>{lang.label}</option>
                ))}
              </Select>
            ) : (
              <Select value="YAML" disabled className={s.select}>
                <option value="YAML">YAML</option>
              </Select>
            )}
            <i className={s.selectChevron} aria-hidden="true" />
          </div>
          <label className={`${s.label} mt-4`}>Body</label>
          <div className={s.editorFrame}>
            <Editor
              value={modalValue}
              onValueChange={setModalValue}
              highlight={(code) => highlight(code, highlightLanguage)}
              padding={{ top: 6, right: 10, bottom: 6, left: 10 }}
              textareaClassName="focus:outline-none"
              className={s.editor}
            />
          </div>
        </div>
      </Modal>
    </>
  );
}


/** A schema's body: its columns in a table, in the format its `format` attribute names, or text when the table cannot hold it. */
export function SchemaEditor({ attrDef }: { attrDef: AttributeSpec }) {
  const { value, element } = useAttributeState<string>(attrDef, (raw) => raw || '');
  const model = useInspectedModel();
  const format = editedFormat(model.attribute(element, 'format'), value);
  if (format) return <ColumnEditor attrDef={attrDef} edited={format} />;
  return (
    <>
      <p className="mt-1 px-1 text-[0.6875rem]/4 text-stone-600">
        Edited as text.
      </p>
      <CodeEditor attrDef={attrDef} />
    </>
  );
}

function ColumnEditor({ attrDef, edited }: { attrDef: AttributeSpec; edited: SchemaFormat }) {
  const { value, element, modeler } = useAttributeState<string>(attrDef, (raw) => raw || '');
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

  return (
    <>
      <Button className={s.openButton} onClick={open}>
        <i className={ICONS.table} aria-hidden="true" /> Edit columns
      </Button>
      <Modal
        isOpen={modalOpen}
        onClose={close}
        title={`Edit columns: ${t(attrDef)}`}
        size="xl"
        footer={(
          <>
            <Button className={d.secondaryBtn} onClick={close}>Cancel</Button>
            <Button className={d.primaryBtn} onClick={save}>Save</Button>
          </>
        )}
      >
        <div className={s.body}>
          <div className={s.toolbar}>
            <div className={s.formats}>
              <label className={s.formatRadio}>
                <input type="radio" name="schema-format" value="csvw" checked={format === 'csvw'} onChange={() => setFormat('csvw')} className={s.radio} />
                CSVW JSON-LD
              </label>
              <label className={s.formatRadio}>
                <input type="radio" name="schema-format" value="linkml" checked={format === 'linkml'} onChange={() => setFormat('linkml')} className={s.radio} />
                LinkML YAML
              </label>
            </div>
            <button type="button" className={s.quietLink} onClick={() => setShowSource((v) => !v)}>
              {showSource ? 'Hide source' : 'View source'}
            </button>
          </div>

          {showSource ? (
            <pre className={s.source}>{sourcePreview}</pre>
          ) : (
            <div className={s.table}>
              <table className="w-full text-sm">
                <thead>
                  <tr className={s.head}>
                    <th className={`${s.headCell} w-8`}></th>
                    <th className={s.headCell}>Name</th>
                    <th className={`${s.headCell} w-32`}>Datatype</th>
                    <th className={s.headCell}>Description</th>
                    <th className={`${s.headCell} w-14`}>Req.</th>
                    <th className={`${s.headCell} w-24`}></th>
                  </tr>
                </thead>
                <tbody>
                  {columns.length === 0 ? (
                    <tr>
                      <td colSpan={6} className={s.empty}>No columns yet.</td>
                    </tr>
                  ) : (
                    columns.map((c, idx) => (
                      <tr key={idx} className={s.row}>
                        <td className={`${s.cell} text-center text-xs text-stone-500`}>{idx + 1}</td>
                        <td className={s.cell}>
                          <input
                            type="text"
                            value={c.name}
                            onChange={(e) => updateColumn(idx, { name: e.target.value })}
                            className={s.cellInput}
                            placeholder="column_name"
                          />
                        </td>
                        <td className={s.cell}>
                          <select
                            value={c.datatype}
                            onChange={(e) => updateColumn(idx, { datatype: e.target.value })}
                            className={s.cellInput}
                          >
                            {!DATATYPES.includes(c.datatype) && <option value={c.datatype}>{c.datatype}</option>}
                            {DATATYPES.map((dt) => (
                              <option key={dt} value={dt}>{dt}</option>
                            ))}
                          </select>
                        </td>
                        <td className={s.cell}>
                          <input
                            type="text"
                            value={c.description}
                            onChange={(e) => updateColumn(idx, { description: e.target.value })}
                            className={`${s.cellInput} font-sans`}
                            placeholder="(optional)"
                          />
                        </td>
                        <td className={`${s.cell} text-center`}>
                          <input
                            type="checkbox"
                            checked={c.required}
                            onChange={(e) => updateColumn(idx, { required: e.target.checked })}
                            className={s.radio}
                          />
                        </td>
                        <td className={`${s.cell} text-right whitespace-nowrap`}>
                          <button type="button" onClick={() => moveColumn(idx, -1)} disabled={idx === 0} title="Move up" aria-label="Move up" className={s.rowButton}>
                            <i className={ICONS.moveUp} aria-hidden="true" />
                          </button>
                          <button type="button" onClick={() => moveColumn(idx, 1)} disabled={idx === columns.length - 1} title="Move down" aria-label="Move down" className={s.rowButton}>
                            <i className={ICONS.moveDown} aria-hidden="true" />
                          </button>
                          <button type="button" onClick={() => removeColumn(idx)} title="Remove column" aria-label="Remove column" className={s.removeButton}>
                            <i className={ICONS.close} aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <div className={s.tableFoot}>
                <button type="button" onClick={addColumn} className={s.addButton}>
                  <i className={ICONS.plus} aria-hidden="true" />
                  Add column
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
