import PropTypes from 'prop-types';
import { Input, Label, Textarea, Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { useContext, useState } from 'react';
import { ModelerContext, InspectorContext } from '../contexts';
import { t } from '../../i18n';
import { getExtensionElementOrBusinessObject, isExtensionPrefix } from '../extensionElements';
import { executeCommand } from '../commands';


export function StringInput(props) {

    const { bpmnProperty, isMarkdown } = props;
    const { element, businessObject } = useContext(InspectorContext);

    const name = bpmnProperty.ns.name;
    const isSchemaProp = isExtensionPrefix(bpmnProperty.ns?.prefix);

    // extends-based props (e.g., isDataOperation) live on the BO even though they
    // have a studyflow: prefix – only use the extension element for wrapper-only props
    const usesExtension = isSchemaProp && !businessObject.$descriptor.properties.some(
        (p) => p === bpmnProperty
    );
    const target = usesExtension ? getExtensionElementOrBusinessObject(businessObject) : businessObject;
    const useExt = usesExtension && target !== businessObject;
    const [value, setValue] = useState(
        target.get(name) || ''
    );

    const { modeler } = useContext(ModelerContext);

    function handleChange(event) {
        const newValue = event.target.value;
        setValue(newValue);

        executeCommand(modeler, {
            type: 'inspector-update-property',
            element,
            propertyName: name,
            value: newValue,
            useExtension: useExt,
        });

    }

    return (
        <>
            <Label className="flex items-center justify-between">
                {t(name)}
                <Popover className="relative group">
                    <PopoverButton><i className="bi bi-patch-question text-stone-400"></i></PopoverButton>
                    <PopoverPanel anchor="top end" className="max-w-md w-64 bg-stone-700 text-xs text-stone-300 p-2 rounded-lg shadowxl">
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
