
import { useContext, useEffect, useState, useCallback, useRef } from 'react';
import { ModelerContext, InspectorContext } from '../contexts';

import { getBusinessObject, is } from 'bpmn-js/lib/util/ModelUtil';
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react';
import { PropertyField } from './field';
import { t } from '../../i18n';
import { planeSuffix } from 'bpmn-js/lib/util/DrilldownUtil';
import { ToggleButton } from './ToggleButton';


function _removePlaneSuffix(id: string): string {
  return id.replace(new RegExp(planeSuffix + '$'), '');
}

const editableBPMNProps = {
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
    const [element, setElement] = useState<any>(null);
    const [rootElement, setRootElement] = useState<any>(null);
    const [isVisible, setIsVisible] = useState(true);
    const elementRef = useRef<any>(null);
    const rootRef = useRef<any>(null);

    const setElementAndRef = useCallback((el: any) => {
        setElement(el);
        elementRef.current = el;
    }, []);

    const setRootAndElement = useCallback((el: any) => {
        setRootElement(el);
        rootRef.current = el;
        setElementAndRef(el);
    }, [setElementAndRef]);


    const getProperties = useCallback((element: any) => {
        // TODO automatically populate group names
        let propCategories: Record<string, any[]> = {};
        getBusinessObject(element).$descriptor.properties.forEach((prop: any) => {
            if (prop.ns.prefix == 'bpmn' && !editableBPMNProps.hasOwnProperty(prop.ns.name)) {
                return;
            }
            let categories: string[] = prop.categories || ["General"];
            if (prop.ns.name === "bpmn:documentation") {
                categories = ["Documentation"];
            }
            categories.forEach((cat: string) => {
                if (!propCategories[cat]) {
                    // initialize empty array
                    propCategories[cat] = [];
                }
                propCategories[cat].push(prop);
            });
        });

        // remove empty groups using filter and Object.fromEntries
        const filtered = Object.entries(propCategories).filter(([, v]) => v.length > 0);
        return Object.fromEntries(filtered) as Record<string, any[]>;
    }, []);

    useEffect(() => {
        const initialRoot = canvas.getRootElement();
        setRootAndElement(initialRoot);

        function onRootChanged(e: any) {
            // The root element is now properly updated when its ID changes
            // because the plane ID is also updated in StringInput.jsx
            var newRootElement = canvas.getRootElement();
            setRootAndElement(newRootElement);
        }

        function onSelectionChanged(e: any) {
            const selections = e.newSelection;
            const root = rootRef.current || canvas.getRootElement();
            var newElement = selections.length === 1 ? selections[0] : root;
            setElementAndRef(newElement);
        }

        function onElementChanged(e: any) {
            // Refresh the element when properties change (including ID changes)
            if (elementRef.current && e.element && e.element.id === elementRef.current.id) {
                setElementAndRef(e.element);
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

    }, [modeler, eventBus, canvas, setElementAndRef, setRootAndElement]);

    function renderCategories(el: any) {
        const categories = Object.entries(getProperties(el));
        const defaultIndex = Math.max(
            0,
            categories.findIndex(([catName]) => catName === 'General')
        );

        return (
            <>
                <h1 className="pb-0 text-lg font-bold p-2 bg-stone-100 rounded-2xl text-stone-900">{el.type.split(':')[1]}</h1>
                <h2 className="text-xs text-left italic font-mono px-2 pb-2 bg-stone-100 text-stone-500">{el.type}</h2>
                <div className="w-full">
                    <TabGroup defaultIndex={defaultIndex}>
                        <TabList className="flex flex-wrap gap-1 px-1 pb-2 bg-stone-100 rounded-xl p-1">
                            {categories.map(([catName]) => (
                                <Tab
                                    key={catName}
                                    className={({ selected }) =>
                                        [
                                            'px-2 py-1 text-xs font-semibold rounded-lg border transition',
                                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-400',
                                            selected
                                                ? 'bg-white text-stone-900 border-stone-300 shadow-sm'
                                                : 'bg-transparent text-stone-700 border-transparent hover:bg-stone-100/80 hover:text-stone-900'
                                        ].join(' ')
                                    }
                                >
                                    {t(catName)}
                                </Tab>
                            ))}
                        </TabList>
                        <TabPanels className="p-1">
                            {categories.map(([catName, catProperties]) => (
                                <TabPanel
                                    key={catName}
                                    className="p-1 rounded-xl bg-stone-50"
                                >
                                    {catProperties.map((p: any) => (
                                        <PropertyField key={el.id + p.ns.name} bpmnProperty={p} />
                                    ))}
                                </TabPanel>
                            ))}
                        </TabPanels>
                    </TabGroup>
                
                {/* <Disclosure
                    defaultOpen={false}
                    key={"Data"}>
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
                </Disclosure> */}
                </div>
            </>
        );
    }

    return (
        <InspectorContext.Provider
            value={{ element: element ?? undefined, businessObject: element ? getBusinessObject(element) : undefined }}>
            {element &&
                <ToggleButton
                    isInspectorVisible={isVisible}
                    onClick={() => setIsVisible(!isVisible)}
                />
            }
            <div className={`fixed w-80 top-4 right-4 border-2 border-stone-200 bg-stone-100 rounded-2xl `
                + (isVisible ? '' : 'hidden')}>
                {element && renderCategories(element) }
            </div>
        </InspectorContext.Provider>
    )

}
