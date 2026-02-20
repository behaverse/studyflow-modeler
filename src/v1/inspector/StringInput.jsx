import PropTypes from 'prop-types';
import { Input, Label, Textarea, Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { useContext, useState } from 'react';
import { ModelerContext, InspectorContext } from '../contexts';
import { t } from '../../i18n';
import { getStudyflowExtension, setExtensionProperty } from '../extensionElements';


export function StringInput(props) {

    const { bpmnProperty, isMarkdown } = props;
    const { element, businessObject } = useContext(InspectorContext);

    const name = bpmnProperty.ns.name;
    const isStudyflowProp = bpmnProperty.ns?.prefix === 'studyflow';

    // extends-based props (e.g., isDataOperation) live on the BO even though they
    // have a studyflow: prefix – only use the extension element for wrapper-only props
    const isExtendsProp = businessObject.$descriptor.properties.some(
        (p) => p === bpmnProperty
    );
    const ext = (isStudyflowProp && !isExtendsProp) ? getStudyflowExtension(element) : null;
    const useExt = isStudyflowProp && !isExtendsProp && !!ext;
    const [value, setValue] = useState(
        useExt ? (ext.get(name) || '') : (businessObject.get(name) || '')
    );

    const modeling = useContext(ModelerContext).modeler.get('injector').get('modeling');
    const elementRegistry = useContext(ModelerContext).modeler.get('elementRegistry');

    function handleChange(event) {
        const newValue = event.target.value;
        setValue(newValue);

        // Studyflow properties → update the extension element or BO
        if (isStudyflowProp) {
            if (useExt) {
                setExtensionProperty(element, name, newValue, modeling);
            } else {
                modeling.updateProperties(element, { [name]: newValue });
            }
            return;
        }

        // For non-ID changes, update properties normally
        if (name !== "bpmn:id") {
            modeling.updateProperties(element, {
                [name]: newValue
            });
            return;
        }

        // For ID changes, we need to handle them differently
        const e = elementRegistry.get(element.id);
        modeling.updateProperties(e, {
            id: newValue
        });

    }

    return (
        <>
            <Label className="flex items-center justify-between">
                {t(name)}
                <Popover className="relative group">
                    <PopoverButton><i className="bi bi-patch-question text-stone-400"></i></PopoverButton>
                    <PopoverPanel anchor="top end" className="max-w-sm w-60 bg-stone-700 text-xs text-stone-300 p-2 rounded-lg shadowxl">
                        <pre className="font-mono text-xs font-bold text-white">{name}</pre>
                        {bpmnProperty?.description}
                    </PopoverPanel>
                </Popover>
            </Label>
            {isMarkdown &&
                <Textarea
                    name={name}
                    onChange={handleChange}
                    value={value}
                    rows={4}
                    className="px-2 py-1 w-full rounded-md border-none bg-white/10 font-mono text-sm/4 text-stone-200 placeholder-stone-500 focus:outline-2 focus:-outline-offset-2 focus:outline-white/30"
                />
            }
            {!isMarkdown &&
                <Input
                    name={name}
                    type="text"
                    onChange={handleChange}
                    value={value}
                    className="px-2 py-1 w-full rounded-md border-none bg-white/10 font-mono text-sm/6 text-stone-200 placeholder-stone-500 focus:outline-2 focus:-outline-offset-2 focus:outline-white/30"
                />}
        </>
    );

}

StringInput.propTypes = {
    bpmnProperty: PropTypes.node.isRequired,
    isMarkdown: PropTypes.bool
}
