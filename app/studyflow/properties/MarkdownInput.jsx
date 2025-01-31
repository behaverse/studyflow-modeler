import PropTypes from 'prop-types';
import { Textarea, Label } from '@headlessui/react';
import { useContext, useState } from 'react';
import { ModelerContext, PropertiesPanelContext } from '../../contexts';
import { t } from '../../i18n';

export function MarkdownInput(props) {

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
            <Textarea
                name={name}
                onChange={handleChange}
                value={value}
                rows={4}
                className="px-2 py-1 w-full rounded-md border-none bg-stone-200 font-mono text-sm/4 text-black focus:outline-2 focus:-outline-offset-2 focus:outline-stone-600"
            />
        </>
    );
}

MarkdownInput.propTypes = {
    bpmnProperty: PropTypes.node.isRequired,
}
