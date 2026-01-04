
import { useContext, useEffect, useState, useCallback } from 'react';
import { ModelerContext, InspectorContext } from '../contexts';

import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';
import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/react';
import { Tab, TabList, TabPanel, TabPanels, TabGroup } from '@headlessui/react';
import { PropertyField } from './field';
import { t } from '../../i18n';
import { planeSuffix } from 'bpmn-js/lib/util/DrilldownUtil';

function _removePlaneSuffix(id: string): string {
  return id.replace(new RegExp(planeSuffix + '$'), '');
}

const defaultPropsDescriptions = {
    // 'bpmn:type': "Type of the element",
    // 'bpmn:name': "Human-readable label",
    'bpmn:id': "Unique identifier of the element",
    'bpmn:documentation': "Short description or link to a description",
};

export function Panel({ className = '', ...props }) {

    const {modeler} = useContext(ModelerContext);
    const injector = modeler.get('injector');
    const eventBus = injector.get('eventBus');
    const canvas = modeler.get('canvas')
    const [element, setElement] = useState(null);
    const [rootElement, setRootElement] = useState(null);


    const getProperties = useCallback((element: any) => {
        // TODO automatically populate group names
        var groups = {
            "general-panel": [],
            "studyflow-panel": [],
            "data-panel": [],
        }
        getBusinessObject(element).$descriptor.properties.forEach((prop) => {
            if (prop.ns.prefix === 'studyflow') {
                groups["studyflow-panel"].push(prop);
            }
            if (Object.keys(defaultPropsDescriptions).includes(prop.ns.name)) {
                prop.description = defaultPropsDescriptions[prop.ns.name];
                groups["general-panel"].push(prop);
            }
        });

        // remove empty groups using filter and Object.fromEntries
        groups = Object.entries(groups).filter(([, v]) => v.length > 0);
        groups = Object.fromEntries(groups);
        return groups;
    }, []);

    useEffect(() => {
        function onRootChanged(e) {
            // The root element is now properly updated when its ID changes
            // because the plane ID is also updated in StringInput.jsx
            var newRootElement = canvas.getRootElement();
            setRootElement(newRootElement);
            setElement(newRootElement);
        }

        function onSelectionChanged(e) {
            const selections = e.newSelection;
            var newElement = selections.length === 1 ? selections[0] : rootElement;
            setElement(newElement);
        }

        function onElementChanged(e: any) {
            // Refresh the element when properties change (including ID changes)
            if (element && e.element && e.element.id === element.id) {
                setElement(e.element);
            }
        }

        eventBus.on('selection.changed', onSelectionChanged);
        eventBus.on('root.set', onRootChanged);
        eventBus.on('element.changed', onElementChanged);

        return () => {
            eventBus.off('selection.changed', onSelectionChanged);
            eventBus.off('root.set', onRootChanged);
            eventBus.off('element.changed', onElementChanged);
        };

    }, [modeler, eventBus, canvas, rootElement, element]);

    function renderGroupTabs(el) {
        return (
            <>
                <h1 className="text-lg text-left font-bold px-2 pt-2 bg-stone-200 sticky top-0 text-black border-stone-300">{el.type.split(':')[1]}</h1>
                <h2 className="text-xs text-left italic font-mono px-2 pb-2 bg-stone-200 text-stone-600 sticky">{el.type}</h2>
        <div className="w-full">
            <TabGroup defaultIndex={0}>
              <TabList className="flex flex-row bg-stone-200 px-2 text-sm justify-left space-x-0">
              {Object.entries(getProperties(el)).map(([groupName,]) =>
                    <Tab key={groupName} className="bg-stone-200 py-1 px-2 data-[selected]:font-bold data-[selected]:bg-stone-50 data-[selected]:border-t-2 border-black data-[hover]:bg-stone-200  focus:outline-none focus-visible:outline-none">{t(groupName)}</Tab>
                            )}
                <Tab key={"data-panel"} className="bg-stone-200 py-1 px-2 data-[selected]:font-bold data-[selected]:bg-stone-50 data-[selected]:border-t-2 border-black data-[hover]:bg-stone-200  focus:outline-none focus-visible:outline-none">{t("data-panel")}</Tab>
              </TabList>
              <TabPanels className="pt-3">
              {Object.entries(getProperties(el)).map(([groupName, grpBpmnProperties]) =>
                    <TabPanel key={groupName}>
                        {grpBpmnProperties.map((p) => (
                            // this key renders the conditional property if needed 
                            <PropertyField key={el.id + p.ns.name} bpmnProperty={p} />
                        ))}
                    </TabPanel>
                            )}
                            {/* Data Panel */}
                    <TabPanel key="data-panel">
                                <div className="py-1 text-center mx-8 text-stone-900 bg-stone-200 hover:bg-stone-300 rounded shadow-xs rounded-base text-sm cursor-pointer active:bg-stone-400
                        ">Edit Schema</div>
                    </TabPanel>
              </TabPanels>
            </TabGroup>
                </div>
                </>
          )
    }

    function renderGroups(el, style="tab") {

        if (style === "tab") {
            return renderGroupTabs(el);
        }

        // default style
        return (
            <>
            <h1 className="text-lg font-bold p-2 bg-stone-100 border-b border-dashed  border-stone-300 sticky top-0 text-stone-900">{el.type.split(':')[1]}</h1>
            <div className="w-full">
            {Object.entries(getProperties(el)).map(([groupName, grpBpmnProperties]) =>
                <Disclosure
                    defaultOpen={groupName === "general"}
                    key={groupName}>
                    <DisclosureButton
                        className="group p-2 text-left w-full text-md font-semibold text-stone-800">
                        {t(groupName)}
                        <i className="bi bi-caret-right-fill group-data-[open]:rotate-90 pe-1 group-data-[open]:pt-1 float-start"></i>
                    </DisclosureButton>
                    <DisclosurePanel transition
                        className="p-1 origin-top transition duration-200 ease-out data-[closed]:-translate-y-6 data-[closed]:opacity-0">
                        {grpBpmnProperties.map((p) => (
                            // this key renders the conditional property if needed 
                            <PropertyField key={el.id + p.ns.name} bpmnProperty={p} />
                        ))}
                    </DisclosurePanel>
                </Disclosure>
            )}
                <Disclosure
                    defaultOpen={false}
                    key={"data-panel"}>
                    <DisclosureButton
                        className="group p-2 text-left w-full text-md font-semibold text-stone-800">
                        {t('data-panel')}
                        <i className="bi bi-caret-right-fill group-data-[open]:rotate-90 pe-1 group-data-[open]:pt-1 float-start"></i>
                    </DisclosureButton>
                    <DisclosurePanel transition
                        className="p-1 origin-top transition duration-200 ease-out data-[closed]:-translate-y-6 data-[closed]:opacity-0">
                    <div className="p-2 italic text-stone-600">
                        Edit Schema
                    </div>
                    </DisclosurePanel>
                </Disclosure>
            </div>
            </>
        );
    }

    return (
        <InspectorContext.Provider
            value={{ element: element, businessObject: getBusinessObject(element) }}>
            <div className={`bg-stone-50 md:basis-1/4 basis-1/2 overflow-y-auto h-[calc(100vh-4rem)] overscroll-contain ${className}`}>
                {element && renderGroups(element, "tab") }
            </div>
        </InspectorContext.Provider>
    )

}
