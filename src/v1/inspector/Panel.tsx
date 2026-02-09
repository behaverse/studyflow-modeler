
import { useContext, useEffect, useState, useCallback, useRef } from 'react';
import { ModelerContext, InspectorContext } from '../contexts';

import { getBusinessObject, is } from 'bpmn-js/lib/util/ModelUtil';
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react';
import { PropertyField, isPropertyVisible } from './field';
import { t } from '../../i18n';
import { ToggleButton } from './ToggleButton';


// List of BPMN properties that are editable in the inspector, otherwise they are hidden
const editableBPMNProps = [
    // 'bpmn:type': "Type of the element",
    // 'bpmn:name': "Human-readable label",
    'bpmn:id'
];

export function Panel({ className = '', ...props }) {

    const {modeler} = useContext(ModelerContext);
    const injector = modeler.get('injector');
    const eventBus = injector.get('eventBus');
    const canvas = modeler.get('canvas')
    const [element, setElement] = useState<any>(null);
    const [rootElement, setRootElement] = useState<any>(null);
    const [isVisible, setIsVisible] = useState(true);
    const [, rerenderCategoryBar] = useState(0);
    const elementRef = useRef<any>(null);
    const rootRef = useRef<any>(null);
    const categoryBarRef = useRef<string>('');

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
        let propCategories: Record<string, any[]> = {};
        const businessObject = getBusinessObject(element);
        businessObject.$descriptor.properties.forEach((prop: any) => {
            if (prop.ns.prefix == 'bpmn' && !editableBPMNProps.includes(prop.ns.name)) {
                return;
            }
            if (!isPropertyVisible(prop, businessObject)) {
                return;
            }
            let categories: string[] = prop.categories || ["General"];

            categories.forEach((cat: string) => {
                if (!propCategories[cat]) {
                    propCategories[cat] = [];  // initialize
                }
                propCategories[cat].push(prop);
            });
        });

        // remove empty groups using filter and Object.fromEntries
        const filtered = Object.entries(propCategories).filter(([, v]) => v.length > 0);
        return Object.fromEntries(filtered) as Record<string, any[]>;
    }, []);

    const syncCategoriesBar = useCallback((element: any, shouldRender: boolean) => {
        if (!element) {
            categoryBarRef.current = '';
            return;
        }
        const categories = getProperties(element);
        const nextSignature = Object.entries(categories)
            .map(([catName, props]) => `${catName}:${props.map((p: any) => p.ns.name).join(',')}`)
            .join('|');
        if (nextSignature === categoryBarRef.current) {
            return;
        }
        categoryBarRef.current = nextSignature;
        if (shouldRender) {
            rerenderCategoryBar((v) => v + 1);
        }
    }, [getProperties]);

    useEffect(() => {
        const initialRoot = canvas.getRootElement();
        setRootAndElement(initialRoot);
        syncCategoriesBar(initialRoot, false);

        function onRootChanged(e: any) {
            // The root element is now properly updated when its ID changes
            // because the plane ID is also updated in StringInput.jsx
            var newRootElement = canvas.getRootElement();
            setRootAndElement(newRootElement);
            syncCategoriesBar(newRootElement, false);
        }

        function onSelectionChanged(e: any) {
            const selections = e.newSelection;
            const root = rootRef.current || canvas.getRootElement();
            var newElement = selections.length === 1 ? selections[0] : root;
            setElementAndRef(newElement);
            syncCategoriesBar(newElement, false);
        }

        function onElementChanged(e: any) {
            // Refresh the element when properties change (including ID changes)
            if (elementRef.current && e.element && e.element.id === elementRef.current.id) {
                setElementAndRef(e.element);
                syncCategoriesBar(e.element, true);
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

    }, [modeler, eventBus, canvas, setElementAndRef, setRootAndElement, syncCategoriesBar]);

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
                        <TabList className="flex flex-wrap gap-1 px-1 pb-2 bg-stone-100 rounded-xl px-2" id="categories-bar">
                            {categories.map(([catName]) => (
                                <Tab
                                    key={catName}
                                    className={({ selected }) =>
                                        [
                                            'px-2 py-1 text-xs font-semibold rounded-lg border transition',
                                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-400',
                                            selected
                                                ? 'bg-white text-stone-900 border-stone-300 shadow-sm'
                                                : 'bg-stone-100/70 text-stone-700 border-stone-300/60 hover:bg-white hover:text-stone-900 hover:border-stone-300 hover:shadow-xs hover:cursor-pointer',
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
                                    className="rounded-xl bg-stone-50"
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
