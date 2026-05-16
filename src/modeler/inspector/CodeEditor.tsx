import { Button, Select } from '@headlessui/react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';
import 'prismjs/components/prism-yaml';
import 'prismjs/themes/prism.css';
import { t } from '../../i18n';
import { useAttributeState } from './hooks/useAttributeState';
import { codeEditor as s } from '../styles';

export function CodeEditor({ attrDef }: { attrDef: any }) {
  const { value, commit, attributeName } = useAttributeState<string>(attrDef, (raw) => raw || '');
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
    commit(modalValue);
    setModalOpen(false);
  }

  const modal = (
    <div className={s.modalOverlay}>
      <div className={s.modalBackdrop} onClick={closeModal} />
      <div role="dialog" aria-modal="true" className={s.modal}>
        <div className={s.modalHeader}>
          <h3 className={s.modalTitle}>Edit {t(attributeName)}</h3>
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
          <Button className={s.modalCancelBtn} onClick={closeModal}>Cancel</Button>
          <Button className={s.modalSaveBtn} onClick={saveModal}>Save</Button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <Button className={s.openButton} onClick={showEditorModal}>
        <i className="iconify bi--pencil pe-2"></i> Edit {t(attributeName)}
      </Button>
      {modalOpen && createPortal(modal, document.body)}
    </>
  );
}
