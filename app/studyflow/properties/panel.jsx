
import { useContext, useEffect, useState, useReducer } from 'react';
import { ModelerContext, PropertiesPanelContext } from '../../contexts';

import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';
import { PropertiesGroup } from './group';

const defaultPropsDescriptions = {
    // 'bpmn:type': "Type of the element",
    // 'bpmn:name': "Human-readable label",
    'bpmn:id': "Unique identifier of the element",
    'bpmn:documentation': "Short description or URL to a description",
};

export function PropertiesPanel() {

    const modeler = useContext(ModelerContext);
    const injector = modeler.get('injector');
    const eventBus = injector.get('eventBus');
    const [element, setElement] = useState(null);
    const [, forceUpdate] = useReducer(x => x + 1, 0);

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
            if (Object.keys(defaultPropsDescriptions).includes(prop.ns.name)) {
                prop.description = defaultPropsDescriptions[prop.ns.name];
                groups["general"].push(prop);
            }
        });
        return groups;
    }

    useEffect(() => {
        eventBus.on('selection.changed', 1200, (event) => {
            const selections = event.newSelection;
            setElement(null);
            if (selections.length === 1) {
                setElement(selections[0]);
            }
        });

        eventBus.on('element.changed', 1500, (event) => {
            if (element && element.id === event.element.id) {
                event.preventDefault();
                const newElement = event.element;
                console.log('element changed', Object.is(element, newElement));
                setElement(newElement);
                forceUpdate();
            }
        });
    }, [eventBus, element]);

    return (
        <PropertiesPanelContext.Provider
            value={{ element: element, businessObject: getBusinessObject(element) }}>
        <div className="bg-stone-50 basis-1/4 overflow-y-auto h-[calc(100vh-4rem)] overscroll-contain">
            {element &&
                <>
                <h1 className="text-md font-bold p-2 bg-stone-100 sticky top-0">
                    {element.type.split(':')[1]}
                </h1>
                <div className="w-full">
                    {Object.entries(getProperties(element)).map(
                        ([group_name, grpBpmnProperties]) => 
                            <PropertiesGroup
                                key={group_name}
                                name={group_name}
                                bpmnProperties={grpBpmnProperties} />
                    )}
                </div>
                </>
            }
            </div>
        </PropertiesPanelContext.Provider>
    )

}
