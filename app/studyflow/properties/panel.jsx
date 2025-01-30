
import { useContext, useEffect, useState } from 'react';
import { ModelerContext } from '../../contexts';

import { Input, Field, Label, Description } from '@headlessui/react';
import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';

const defaultPropsDescriptions = {
    type: "Type of the element",
    name: "Human-readable label",
    id: "Unique identifier of the element",
    documentation: "Short description or URL to a description",
};

export function PropertiesPanel() {

    const modeler = useContext(ModelerContext);
    const injector = modeler.get('injector');
    const eventBus = injector.get('eventBus');
    const [selectedElement, setSelectedElement] = useState(null);
    const [businessObj, setBusinessObj] = useState(null);

    const getProperties = (element) => {
        // TODO automatically populate group names
        const groups = {
            "general": [],
            "studyflow": []
        }
        getBusinessObject(element).$descriptor.properties.forEach((prop) => {
            if (prop.ns.prefix === 'studyflow') {
                groups["studyflow"].push(prop);
            }
            if (Object.keys(defaultPropsDescriptions).includes(prop.ns.localName)) {
                prop.description = defaultPropsDescriptions[prop.ns.localName];
                groups["general"].push(prop);
            }
        });
        return groups;
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
                setBusinessObj(null);
                console.log('Nothing selected');
            } else if (selections.length === 1) {
                const bOjb = getBusinessObject(selections[0]);
                setBusinessObj(bOjb);
                setSelectedElement(selections[0]);
                console.log('Element selected:', getBusinessObject(selections[0]));
            } else {
                setSelectedElement(null);
                setBusinessObj(null);
                console.log('multiple elements selected');
            }
        });
    }, [eventBus, selectedElement, businessObj]);

    return (
        <div className="bg-stone-50 basis-1/4 overflow-y-auto h-[calc(100vh-4rem)] overscroll-contain">
            {selectedElement &&
                <>
                <h1 className="text-md font-semibold p-2 bg-stone-100 sticky top-0">
                    {selectedElement.type.split(':')[1]}
                </h1>
                <div className="w-full">
                    {Object.entries(getProperties(selectedElement)).map(([group_name, groupProps], _index) => (
                        <div key={group_name} className="p-4">
                        <h2 className="text-lg font-semibold text-stone-300">{group_name}</h2>
                                    {groupProps.map((p) => (
                                        <Field key={p.ns.localName} className="mx-2 pb-4">
                                            <Label>{p.ns.localName}</Label>
                                            <Input name={p.ns.localName} type="text"
                                                onChange={(e) => {handleChange(p, e)}}
                                                value={businessObj.get(p.ns.localName)}
                                                className="px-2 py-1 w-full rounded-md border-none bg-stone-200 font-mono text-sm/6 text-black focus:outline-2 focus:-outline-offset-2 focus:outline-stone-600"
                                            />
                                            <Description className="text-xs/4 text-stone-400">
                                                {p?.description}
                                                {console.log(p)}
                                            </Description>
                                        </Field>
                                    ))}
                                </div>
                            ))}
                </div>
                </>
            }
        </div>
    )

}
