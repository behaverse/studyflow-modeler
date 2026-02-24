import { Button, Select } from '@headlessui/react';
import { useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import { ModelerContext, InspectorContext } from '../contexts';
import { t } from '../../i18n';
import { getExtensionProperty, setExtensionProperty } from '../extensionElements';


export function SchemaEditor(props: { bpmnProperty: any; }) {

    const { bpmnProperty } = props;
    const { element } = useContext(InspectorContext);

    const [value, setValue] = useState(getExtensionProperty(element, bpmnProperty?.ns.name) || '');
    const modeling = useContext(ModelerContext).modeler.get('injector').get('modeling');

    const [modalOpen, setModalOpen] = useState(false);
    const [modalValue, setModalValue] = useState(value);

    function handleChange(event: any) {
        const newValue = event.target.value;
        setValue(newValue);
        setExtensionProperty(element, bpmnProperty?.ns.name, newValue, modeling);
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
        setExtensionProperty(element, bpmnProperty?.ns.name, modalValue, modeling);
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
                            <i className="bi bi-x-lg cursor-pointer"></i>
                        </button>
                    </div>
                    <div className="p-4">
                        <label className="block text-sm font-medium mb-2">Language</label>
                        <Select value="LinkML" disabled className="appearance-none p-2 w-full rounded-md border-none text-sm text-black/50 bg-stone-200">
                            <option value="LinkML">LinkML</option>
                        </Select>
                    </div>
                    <div className="p-4">
                        <label className="block text-sm font-medium mb-2">Body</label>
                        <textarea value={modalValue} onChange={(e) => setModalValue(e.target.value)} className="w-full h-[40vh] max-h-[50vh] rounded-lg border-none bg-stone-200 py-1.5 px-3 font-mono text-sm/6 text-black focus:outline-2 focus:-outline-offset-2 focus:outline-stone-600 resize-none" />
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
            <Button as="button" className="w-full mt-2 p-1 rounded-md hover:text-white cursor-pointer bg-stone-600 hover:bg-stone-700" onClick={showEditorModal}>
                <i className="bi bi-pencil pe-2"></i> Edit Schema
            </Button>

            {modalOpen && createPortal(getEditorModal(), document.body)}

        </>
    );

}
