
import { useContext, useEffect, useState, useCallback } from 'react';
import { ModelerContext, PropertiesPanelContext } from '../contexts';

import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';
import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/react';
import { PropertyField } from './field';
import { t } from '../../i18n';


const defaultPropsDescriptions = {
    // 'bpmn:type': "Type of the element",
    // 'bpmn:name': "Human-readable label",
    'bpmn:id': "Unique identifier of the element",
    'bpmn:documentation': "Short description or link to a description",
};

export function PropertiesPanel() {

    const {modeler} = useContext(ModelerContext);
    const injector = modeler.get('injector');
    const eventBus = injector.get('eventBus');
    const [element, setElement] = useState(null);


    const getProperties = useCallback((element) => {
        // TODO automatically populate group names
        var groups = {
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

        // remove empty groups using filter and Object.fromEntries
        groups = Object.entries(groups).filter(([, v]) => v.length > 0);
        groups = Object.fromEntries(groups);
        return groups;
    }, []);

    useEffect(() => {
        function onSelectionChanged(e) {
            const selections = e.newSelection;
            var newElement = selections.length === 1 ? selections[0] : null;
            setElement(newElement);
        }

        eventBus.on('selection.changed', onSelectionChanged);
        return () => {
            eventBus.off('selection.changed', onSelectionChanged);
        };
    }, [eventBus, element]);

    return (
        <PropertiesPanelContext.Provider
            value={{ element: element, businessObject: getBusinessObject(element) }}>
            <div className="bg-stone-50 basis-1/4 overflow-y-auto h-[calc(100vh-4rem)] overscroll-contain">
                {element &&
                    <>
                        <h1 className="text-lg font-bold p-2 bg-stone-100 border-b border-dashed  border-stone-300 sticky top-0 text-stone-700">
                            {element.type.split(':')[1]}
                        </h1>
                        <div className="w-full">
                            {Object.entries(getProperties(element)).map(
                                ([groupName, grpBpmnProperties]) =>
                                    <Disclosure
                                        defaultOpen={groupName === "general"}
                                        key={groupName}>
                                        <DisclosureButton
                                            className="group p-2 text-left w-full text-md font-semibold text-stone-700">
                                            {t(groupName)}
                                            <i className="bi bi-caret-right-fill group-data-[open]:rotate-90 pe-1 group-data-[open]:pt-1 float-start"></i>
                                        </DisclosureButton>
                                        <DisclosurePanel transition
                                            className="p-1 origin-top transition duration-200 ease-out data-[closed]:-translate-y-6 data-[closed]:opacity-0">
                                            {grpBpmnProperties.map((p) => (
                                                // this key renders the conditional property if needed 
                                                <PropertyField key={element.id + p.ns.name} bpmnProperty={p} />
                                            ))}
                                        </DisclosurePanel>
                                    </Disclosure>
                            )}
                        </div>
                    </>
                }
            </div>
        </PropertiesPanelContext.Provider>
    )

}
