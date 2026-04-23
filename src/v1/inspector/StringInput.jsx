import PropTypes from 'prop-types';
import { Input, Label, Textarea, Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { useContext, useState } from 'react';
import { ModelerContext, InspectorContext } from '../contexts';
import { t } from '../../i18n';
import { getProperty } from '../extensionElements';
import { executeCommand } from '../commands';


export function StringInput(props) {

    const { bpmnProperty, isMarkdown } = props;
    const { element } = useContext(InspectorContext);

    const name = bpmnProperty.ns?.name ?? bpmnProperty.name;
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
                    <PopoverPanel anchor="top end" className="max-w-md w-64 bg-stone-700 text-xs text-stone-300 p-2 rounded-lg shadowxl">
                        <pre className="font-mono text-xs font-bold text-white">{bpmnProperty.ns.name}</pre>
                        {bpmnProperty?.description}
                    </PopoverPanel>
                </Popover>
            </Label>
            {isMarkdown &&
                <Textarea
                    name={bpmnProperty.ns.name}
                    onChange={handleChange}
                    value={value}
                    rows={4}
                    className="px-2 py-1 w-full rounded-md border-none bg-white/10 font-mono text-sm/4 text-stone-100 placeholder-stone-500 focus:outline-2 focus:-outline-offset-2 focus:outline-white/20"
                />
            }
            {!isMarkdown &&
                <Input
                    name={bpmnProperty.ns.name}
                    type="text"
                    onChange={handleChange}
                    value={value}
                    className="px-2 py-1 w-full rounded-md border-none bg-white/10 font-mono text-sm/6 text-stone-100 placeholder-stone-500 focus:outline-2 focus:-outline-offset-2 focus:outline-white/20"
                />}
        </>
    );

}

StringInput.propTypes = {
    bpmnProperty: PropTypes.node.isRequired,
    isMarkdown: PropTypes.bool
}
