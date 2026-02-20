import PropTypes from 'prop-types';
import { Select, Label, Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { useContext, useState } from 'react';
import { ModelerContext, InspectorContext } from '../contexts';
import { t } from '../../i18n';
import { getStudyflowExtension, setExtensionProperty } from '../extensionElements';

export function EnumInput(props) {

    const { bpmnProperty } = props;
    const { element, businessObject } = useContext(InspectorContext);

    const name = bpmnProperty.ns.name;
    const isStudyflowProp = bpmnProperty.ns?.prefix === 'studyflow';
    const propertyType = bpmnProperty.type.split(':')[1];
    const pkg = bpmnProperty.definedBy.$pkg;
    const literalValues = pkg['enumerations'].find((e) => e.name === propertyType).literalValues;

    // extends-based props live on the BO even though they have a studyflow: prefix
    const isExtendsProp = businessObject.$descriptor.properties.some(
        (p) => p === bpmnProperty
    );
    const ext = (isStudyflowProp && !isExtendsProp) ? getStudyflowExtension(element) : null;
    const useExt = isStudyflowProp && !isExtendsProp && !!ext;
    const [value, setValue] = useState(
        useExt ? (ext.get(name) || '') : (businessObject.get(name) || '')
    );

    const modeling = useContext(ModelerContext).modeler.get('injector').get('modeling');

    function handleChange(event) {
        const newValue = event.target.value;
        setValue(newValue);
        if (useExt) {
            setExtensionProperty(element, name, newValue, modeling);
        } else {
            modeling.updateProperties(element, {
                [name]: newValue
            });
        }
    }

    return (
        <>
            <Label className="flex items-center justify-between">
                {t(name)}
                <Popover className="relative group">
                    <PopoverButton><i className="bi bi-patch-question text-stone-400"></i></PopoverButton>
                    <PopoverPanel anchor="top end" className="bg-stone-700 text-xs text-stone-300 p-2 rounded-lg shadow-lg">
                        <pre className="font-mono text-xs font-bold text-white">{name}</pre>
                        {bpmnProperty?.description}
                    </PopoverPanel>
                </Popover>
            </Label>
            <div className="relative">
                <Select name={name} aria-label={t(name)}
                    onChange={handleChange}
                    value={value}
                    className="appearance-none px-2 py-1 pr-8 w-full rounded-md border-none bg-white/10 text-sm/6 text-stone-200 focus:outline-2 focus:-outline-offset-2 focus:outline-white/30"
                >
                    {literalValues.map((l) => (
                        <option key={l.value} value={l.value}>{l.name}</option>
                    ))}
                </Select>
                <i className="group bi bi-caret-down pointer-events-none absolute top-1.5 right-2.5" aria-hidden="true"></i>
            </div>
        </>
    );
}

EnumInput.propTypes = {
    bpmnProperty: PropTypes.node.isRequired,
}
