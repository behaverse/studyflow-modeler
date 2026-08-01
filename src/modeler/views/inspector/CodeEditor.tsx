import { Button, Select } from '@headlessui/react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-python';
import 'prismjs/themes/prism.css';
import { t } from '@/i18n';
import { getAttribute } from '@/core/extensions';
import { executeCommand } from '@/modeler/controllers/commandBus';
import { useAttributeState } from '@/modeler/views/inspector/hooks/useAttributeState';
import { codeEditor as s } from '@/modeler/infra/styles';
import { ICONS } from '@/icons';

/**
 * Choices when the attribute names a `languageAttr` (a sibling attribute the
 * select edits — `bpmn:scriptFormat` on a script task). Empty means the
 * evaluating engine's own language, the same default expressions use.
 */
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

export function CodeEditor({ attrDef }: { attrDef: any }) {
  const { value, commit, attributeName, element, modeler } = useAttributeState<string>(attrDef, (raw) => raw || '');
  // Without a languageAttr the body is configuration, which is always YAML.
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
        type: 'update-attribute', element, attributeName: languageAttr, value: modalLanguage || undefined,
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
