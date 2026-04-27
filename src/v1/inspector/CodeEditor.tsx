import { Button, Select } from '@headlessui/react';
import { useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';
import 'prismjs/components/prism-yaml';
import 'prismjs/themes/prism.css';
import { ModelerContext, InspectorContext } from '../contexts';
import { t } from '../../i18n';
import { getProperty } from '../extensions';
import { executeCommand } from '../commands';


export function CodeEditor(props: { bpmnProperty: any; }) {

    const { bpmnProperty } = props;
    const { element } = useContext(InspectorContext);
    const propertyName = bpmnProperty?.ns?.name ?? bpmnProperty?.name;

    const [value, setValue] = useState(getProperty(element, propertyName) || '');
    const { modeler } = useContext(ModelerContext);

    const [modalOpen, setModalOpen] = useState(false);
    const [modalValue, setModalValue] = useState(value);

    function handleChange(event: any) {
        const newValue = event.target.value;
        setValue(newValue);
        executeCommand(modeler, {
            type: 'update-property',
            element,
            propertyName,
            value: newValue,
        });
    }

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
            <div className="fixed inset-0 z-150 flex items-center justify-center p-4 backdrop-blur-xs">
                <div className="absolute" onClick={closeModal} />
                <div role="dialog" aria-modal="true" className="relative z-160 bg-stone-100 rounded-2xl shadow-lg w-full max-w-4xl max-h-[90vh] overflow-auto">
                    <div className="px-4 py-2 flex justify-between items-center">
                        <h3 className="text-lg font-medium">Edit Schema</h3>
                        <button className="text-sm text-slate-500" onClick={closeModal}>
                            <i className="iconify bi--x-lg cursor-pointer"></i>
                        </button>
                    </div>
                    <div className="p-4">
                        <label className="block text-sm font-medium mb-2">Language</label>
                        <Select value="YAML" disabled className="appearance-none p-2 w-full rounded-md border-none text-sm text-black/50 bg-stone-200">
                            <option value="YAML">YAML</option>
                        </Select>
                    </div>
                    <div className="p-4">
                        <label className="block text-sm font-medium mb-2">Body</label>
                        <div className="w-full h-[40vh] max-h-[50vh] overflow-auto rounded-lg bg-stone-200 focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-stone-600">
                            <Editor
                                value={modalValue}
                                onValueChange={setModalValue}
                                highlight={(code) => Prism.highlight(code, Prism.languages.yaml, 'yaml')}
                                padding={{ top: 6, right: 12, bottom: 6, left: 12 }}
                                textareaClassName="focus:outline-none"
                                className="min-h-full font-mono text-sm/6 text-black"
                            />
                        </div>
                    </div>
                    <div className="p-4 flex justify-end gap-2">
                        <Button as="button" className="px-2 py-1 rounded cursor-pointer" onClick={closeModal}>Cancel</Button>
                        <Button as="button" className="px-3 py-1 bg-sky-500 hover:bg-sky-600 text-white rounded-md cursor-pointer" onClick={saveModal}>Save</Button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <>
            <Button as="button" className="w-full mt-2 p-1 rounded-md cursor-pointer bg-[#b0a993]/40 hover:bg-[#b0a993]/60 text-stone-800 hover:text-stone-900 border border-[#b0a993]/40 transition-colors" onClick={showEditorModal}>
                <i className="iconify bi--pencil pe-2"></i> Edit Schema
            </Button>

            {modalOpen && createPortal(getEditorModal(), document.body)}

        </>
    );

}
