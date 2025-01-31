import PropTypes from 'prop-types';
import { Select, Label } from '@headlessui/react';
import { useContext, useState } from 'react';
import { ModelerContext, PropertiesPanelContext } from '../../contexts';
import { t } from '../../i18n';

export function EnumInput(props) {

    const { bpmnProperty } = props;
    const { element, businessObject } = useContext(PropertiesPanelContext);

    const name = bpmnProperty.ns.name;
    const propertyType = bpmnProperty.type.split(':')[1];
    const pkg = bpmnProperty.definedBy.$pkg;
    const literalValues = pkg['enumerations'].find((e) => e.name === propertyType).literalValues;
    const [value, setValue] = useState(businessObject.get(name) || '');

    const modeling = useContext(ModelerContext).get('injector').get('modeling');

    function handleChange(event) {
        const newValue = event.target.value;
        setValue(newValue);
        modeling.updateProperties(element, {
            [name]: newValue
        });
    }
    
    return (
        <>
            <Label>{t(name)}</Label>
            <div className="relative">
            <Select name={name} aria-label={t(name)}
                onChange={handleChange}
                value={value}
                className="appearance-none px-2 py-1 pr-8 w-full rounded-md border-none bg-stone-200 text-sm/6 text-black focus:outline-2 focus:-outline-offset-2 focus:outline-stone-600"
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
