
import { useContext, useEffect, useState } from 'react';
import { ModelerContext } from '../../contexts';

import { Input, Field, Label, Description } from '@headlessui/react';
import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';

export function PropertiesPanel() {

    const modeler = useContext(ModelerContext);
    const injector = modeler.get('injector');
    const eventBus = injector.get('eventBus');
    const [selectedElement, setSelectedElement] = useState(null);

    const getProperties = (element) => {
        var defaultProps = ['type', 'name', 'id', 'documentation'];
        var objProperties = [];
        getBusinessObject(element).$descriptor.properties.forEach((prop) => {
            if (prop.ns.prefix === 'studyflow' | defaultProps.includes(prop.ns.localName)) {
                objProperties.push(prop);
            }
        });
        return objProperties;
    }

    function handleChange(property, event) {
        const value = event.target.value;
        const modeling = injector.get('modeling');
        modeling.updateProperties(selectedElement, {
            [property.ns.localName]: value
        });
    }

    useEffect(() => {
        eventBus.on('selection.changed', 1500, (event) => {
            const selections = event.newSelection;
            if (selections.length === 0) {
                setSelectedElement(null);
                console.log('Nothing selected');
            } else if (selections.length === 1) {
                setSelectedElement(selections[0]);
            } else {
                setSelectedElement(null);
                console.log('multiple elements selected');
            }

        });
    }, [eventBus]);

    return (
        <div className="basis-1/5 overflow-y-auto h-[calc(100vh-4rem)] overscroll-contain">
        <h1 className="text-lg p-2 bg-stone-100 sticky top-0">Properties</h1>
            {selectedElement &&
                <div className="w-full">
                {getProperties(selectedElement).map((p) => (
                    <Field key={p.ns.localName} className="mx-2 pb-4">
                        <Label>{p.ns.localName}</Label>
                        <Input name={p.ns.localName} type="text"
                            onChange={(e) => {
                                handleChange(p, e);
                            }}
                            defaultValue={getBusinessObject(selectedElement).get(p.ns.localName)}
                            className="px-2 py-1 w-full rounded-md border-none bg-stone-200 font-mono text-sm/6 text-black focus:outline-2 focus:-outline-offset-2 focus:outline-stone-600"
                        />
                        <Description className="text-xs/4 text-stone-400">Use your real name so people will recognize you.</Description>
                    </Field>
                ))}
                </div>
            }
        </div>
    )

}
