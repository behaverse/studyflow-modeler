import PropTypes from 'prop-types';
import { Checkbox, Label, Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { useContext, useState } from 'react';
import { ModelerContext, InspectorContext } from '../contexts';
import { t } from '../../i18n';
import { getStudyflowExtension, setExtensionProperty } from '../extensionElements';


export function BooleanInput(props) {
    const { bpmnProperty } = props;
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
        useExt ? (ext.get(name) || false) : (businessObject.get(name) || false)
    );

    const modeling = useContext(ModelerContext).modeler.get('injector').get('modeling');

    function handleChange(checked) {
        setValue(checked);
        if (useExt) {
            setExtensionProperty(element, name, checked, modeling);
        } else {
            modeling.updateProperties(element, {
                [name]: checked
            });
        }
    }

    return (
        <div className="flex items-center justify-between">
            <span className="flex items-center gap-2">
            <Checkbox
                checked={value}
                onChange={handleChange}
                className="group block size-4 rounded border border-white/20 bg-white/10 data-[checked]:bg-blue-500"
            >
                {/* Checkmark icon */}
                <svg className="stroke-white opacity-0 group-data-[checked]:opacity-100" viewBox="0 0 14 14" fill="none">
                    <path d="M3 8L6 11L11 3.5" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </Checkbox>
            <Label className="flex items-center justify-between">
                {t(name)}
                </Label>
                </span>
            <Popover className="float-end">
                <PopoverButton><i className="bi bi-patch-question text-stone-400"></i></PopoverButton>
                <PopoverPanel anchor="top end" className="bg-stone-700 text-xs text-stone-300 p-2 rounded-lg shadow-lg">
                    <pre className="font-mono text-xs font-bold text-white">{name}</pre>
                    {bpmnProperty?.description}
                </PopoverPanel>
            </Popover>

        </div>
    );
}

BooleanInput.propTypes = {
    bpmnProperty: PropTypes.node.isRequired,
}
