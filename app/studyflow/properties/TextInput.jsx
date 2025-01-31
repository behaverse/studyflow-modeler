import PropTypes, { element } from 'prop-types';
import { Input, Label } from '@headlessui/react';
import { useContext, useState } from 'react';
import { ModelerContext, PropertiesPanelContext } from '../../contexts';
import { t } from '../../i18n';

export function TextInput(props) {

    const { bpmnProperty } = props;
    const { element, businessObject } = useContext(PropertiesPanelContext);

    const name = bpmnProperty.ns.name;
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
            <Input
                name={name}
                type="text"
                onChange={handleChange}
                value={value}
                className="px-2 py-1 w-full rounded-md border-none bg-stone-200 font-mono text-sm/6 text-black focus:outline-2 focus:-outline-offset-2 focus:outline-stone-600"
            />
        </>
    );
}

TextInput.propTypes = {
    bpmnProperty: PropTypes.node.isRequired,
}
