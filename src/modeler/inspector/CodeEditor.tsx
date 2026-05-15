import { Button, Select } from '@headlessui/react';
import { useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';
import 'prismjs/components/prism-yaml';
import 'prismjs/themes/prism.css';
import { ModelerContext, InspectorContext } from '../contexts';
import { t } from '../../i18n';
import { getProperty } from '@/lib/core/extensions';
import { executeCommand } from '../commands';
import { codeEditor as s } from '../styles';

export function CodeEditor(props: { bpmnProperty: any }) {
  const { bpmnProperty } = props;
  const { element } = useContext(InspectorContext);
  const propertyName = bpmnProperty?.ns?.name ?? bpmnProperty?.name;

  const [value, setValue] = useState(getProperty(element, propertyName) || '');
  const { modeler } = useContext(ModelerContext);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalValue, setModalValue] = useState(value);

  function showEditorModal() {
    setModalValue(value);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
  }

  function saveModal() {
    setValue(modalValue);
    executeCommand(modeler, {
      type: 'update-property',
      element,
      propertyName,
      value: modalValue,
    });
    setModalOpen(false);
  }

  function getEditorModal() {
    return (
      <div className={s.modalOverlay}>
        <div className={s.modalBackdrop} onClick={closeModal} />
        <div role="dialog" aria-modal="true" className={s.modal}>
          <div className={s.modalHeader}>
            <h3 className={s.modalTitle}>Edit {t(propertyName)}</h3>
            <button className={s.modalClose} onClick={closeModal}>
              <i className="iconify bi--x-lg cursor-pointer"></i>
            </button>
          </div>
          <div className={s.modalSection}>
            <label className={s.modalSubLabel}>Language</label>
            <Select value="YAML" disabled className={s.modalLanguageSelect}>
              <option value="YAML">YAML</option>
            </Select>
          </div>
          <div className={s.modalSection}>
            <label className={s.modalSubLabel}>Body</label>
            <div className={s.modalEditorFrame}>
              <Editor
                value={modalValue}
                onValueChange={setModalValue}
                highlight={(code) => Prism.highlight(code, Prism.languages.yaml, 'yaml')}
                padding={{ top: 6, right: 12, bottom: 6, left: 12 }}
                textareaClassName="focus:outline-none"
                className={s.modalEditor}
              />
            </div>
          </div>
          <div className={s.modalActions}>
            <Button as="button" className={s.modalCancelBtn} onClick={closeModal}>Cancel</Button>
            <Button as="button" className={s.modalSaveBtn} onClick={saveModal}>Save</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <Button as="button" className={s.openButton} onClick={showEditorModal}>
        <i className="iconify bi--pencil pe-2"></i> Edit {t(propertyName)}
      </Button>
      {modalOpen && createPortal(getEditorModal(), document.body)}
    </>
  );
}
