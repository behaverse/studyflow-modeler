import PropTypes from 'prop-types';
import { Input, Label, Textarea, Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { useContext, useState } from 'react';
import { ModelerContext, InspectorContext } from '../contexts';
import { t } from '../../i18n';


export function StringInput(props) {

    const { bpmnProperty, isMarkdown } = props;
    const { element, businessObject } = useContext(InspectorContext);

    const name = bpmnProperty.ns.name;
    const [value, setValue] = useState(businessObject.get(name) || '');

    const modeling = useContext(ModelerContext).modeler.get('injector').get('modeling');
    const elementRegistry = useContext(ModelerContext).modeler.get('elementRegistry');
    const canvas = useContext(ModelerContext).modeler.get('canvas');

    function handleChange(event) {
        const newValue = event.target.value;
        setValue(newValue);
        const e = elementRegistry.get(element.id);
        const oldId = e.id;
        modeling.updateProperties(e, {
            [name]: newValue
        });
        if (name === "bpmn:id") {
            elementRegistry.updateId(element, newValue);
            modeling.unclaimId(oldId, element);

            // // also check if <oldId>_plane exists and update it to <newValue>_plane
            // const oldPlaneId = `${oldId}_plane`;
            // const newPlaneId = `${newValue}_plane`;
            // const planeElement = elementRegistry.get(oldPlaneId);
            // if (planeElement) {
            //     elementRegistry.updateId(planeElement, newPlaneId);
            // }
            // // find oldId in canvas.getRootElements() and update it to newValue
            // const rootElements = canvas.getRootElements();
            // console.log("Roots (before)", rootElements);
            // rootElements.forEach((r) => {
            //     if (oldPlaneId.endsWith('_plane') && r.id === oldPlaneId) {
            //         r.id = newPlaneId;
            //     }
            // });
            // console.log("Roots (after)", canvas.getRootElements());

        }

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
                    className="px-2 py-1 w-full rounded-md border-none bg-stone-200 font-mono text-sm/4 text-black focus:outline-2 focus:-outline-offset-2 focus:outline-stone-600"
                />
            }
            {!isMarkdown &&
                <Input
                    name={name}
                    type="text"
                    onChange={handleChange}
                    value={value}
                    className="px-2 py-1 w-full rounded-md border-none bg-stone-200 font-mono text-sm/6 text-black focus:outline-2 focus:-outline-offset-2 focus:outline-stone-600"
                />}
        </>
    );

}

StringInput.propTypes = {
    bpmnProperty: PropTypes.node.isRequired,
    isMarkdown: PropTypes.bool
}
