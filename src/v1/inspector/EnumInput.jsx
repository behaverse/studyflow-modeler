import PropTypes from 'prop-types';
import { Select, Label, Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { useContext, useState } from 'react';
import { ModelerContext, InspectorContext } from '../contexts';
import { t } from '../../i18n';
import { getProperty } from '../extensionElements';
import { executeCommand } from '../commands';

export function EnumInput(props) {

    const { bpmnProperty } = props;
    const { element } = useContext(InspectorContext);

    const name = bpmnProperty.ns?.name ?? bpmnProperty.name;
    const propertyType = bpmnProperty.type.split(':')[1];
    const pkg = bpmnProperty.definedBy.$pkg;
    const literalValues = pkg['enumerations'].find((e) => e.name === propertyType).literalValues;
    const [value, setValue] = useState(
        getProperty(element, name) || ''
    );

    const { modeler } = useContext(ModelerContext);

    function handleChange(event) {
        const newValue = event.target.value;
        setValue(newValue);
        executeCommand(modeler, {
            type: 'update-property',
            element,
            propertyName: name,
            value: newValue,
        });
    }

    return (
        <>
            <Label className="flex items-center justify-between">
                {t(bpmnProperty.ns.name)}
                <Popover className="relative group">
                    <PopoverButton><i className="bi bi-patch-question text-stone-400"></i></PopoverButton>
                    <PopoverPanel anchor="top end" className="bg-stone-700 text-xs text-stone-300 p-2 rounded-lg shadow-lg">
                        <pre className="font-mono text-xs font-bold text-white">{bpmnProperty.ns.name}</pre>
                        {bpmnProperty?.description}
                    </PopoverPanel>
                </Popover>
            </Label>
            <div className="relative">
                <Select name={bpmnProperty.ns.name} aria-label={t(bpmnProperty.ns.name)}
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
