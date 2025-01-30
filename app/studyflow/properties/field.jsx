import PropTypes from 'prop-types';
import { Input, Field, Label, Description } from '@headlessui/react';
import { useContext, useState } from 'react';
import { ModelerContext } from '../../contexts';
import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';


export function PropertyField(props) {
    const { element, bpmnProperty } = props;
    const name = bpmnProperty.ns.name;
    const [value, setValue] = useState(getBusinessObject(element).get(name) || '');

    const modeler = useContext(ModelerContext);
    const injector = modeler.get('injector');
    const modeling = injector.get('modeling');

    function handleChange(event) {
        const newValue = event.target.value;
        setValue(newValue);
        modeling.updateProperties(element, {
            [name]: newValue
        });
    }

    return (
            <Field className="mx-2 pb-2">
                <Label>{name}</Label>
                <Input name={name}
                    type="text"
                    onChange={handleChange}
                    value={value}
                    className="px-2 py-1 w-full rounded-md border-none bg-stone-200 font-mono text-sm/6 text-black focus:outline-2 focus:-outline-offset-2 focus:outline-stone-600"
                />
                <Description className="text-xs/4 text-stone-400">
                    {bpmnProperty?.description}
                </Description>
            </Field>
    );
}

PropertyField.propTypes = {
    element: PropTypes.node.isRequired,
    name: PropTypes.string.isRequired,
    bpmnProperty: PropTypes.node.isRequired
}
