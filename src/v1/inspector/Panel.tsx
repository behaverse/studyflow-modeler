
import { useContext, useEffect, useState, useCallback, useRef } from 'react';
import { ModelerContext, InspectorContext } from '../contexts';

import { getBusinessObject, is } from 'bpmn-js/lib/util/ModelUtil';
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react';
import { PropertyField, isPropertyVisible } from './field';
import { t } from '../../i18n';
import { ToggleButton } from './ToggleButton';
import { getStudyflowExtension, getStudyflowProperties } from '../extensionElements';


// List of BPMN properties that are editable in the inspector, otherwise they are hidden
const editableBPMNProps = [
    // 'bpmn:type': "Type of the element",
    // 'bpmn:name': "Human-readable label",
    'bpmn:documentation',
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

        // Collect extension element property names upfront to deduplicate
        const ext = getStudyflowExtension(element);
        const extPropNames = new Set<string>(
            ext?.$descriptor?.properties?.map((p: any) => p.ns.name) ?? []
        );

        // Show editable BPMN properties and extends-based studyflow properties from the BO
        businessObject.$descriptor.properties.forEach((prop: any) => {
            if (prop.ns.prefix == 'bpmn' && !editableBPMNProps.includes(prop.ns.name)) {
                return;
            }
            // Allow studyflow properties mixed in via extends (e.g., StartEvent, EndEvent)
            if (prop.ns.prefix !== 'bpmn' && prop.ns.prefix !== 'studyflow') return;
            // Skip extends properties that also exist on the extension element wrapper;
            // the extension element version is preferred for correct read/write behavior.
            if (prop.ns.prefix === 'studyflow' && extPropNames.has(prop.ns.name)) return;
            if (!isPropertyVisible(prop, businessObject)) {
                return;
            }
            let categories: string[] = prop.categories || ["General"];
            categories.forEach((cat: string) => {
                if (!propCategories[cat]) propCategories[cat] = [];
                propCategories[cat].push(prop);
            });
        });

        // Show studyflow properties from the extension element wrapper
        if (ext?.$descriptor) {
            ext.$descriptor.properties.forEach((prop: any) => {
                if (!isPropertyVisible(prop, ext)) return;
                let categories: string[] = prop.categories || ["General"];
                categories.forEach((cat: string) => {
                    if (!propCategories[cat]) propCategories[cat] = [];
                    propCategories[cat].push(prop);
                });
            });
        }

        // remove empty groups
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
                <h1 className="pb-0 text-lg font-bold p-2 rounded-2xl text-stone-100">{
                    (() => {
                        const ext = getStudyflowExtension(el);
                        const sfType = ext?.$type?.split(':')[1];
                        return sfType || el.type.split(':')[1];
                    })()
                }</h1>
                <h2 className="text-xs text-left italic font-mono px-2 pb-2 text-stone-300">{
                    (() => {
                        const ext = getStudyflowExtension(el);
                        return ext?.$type || el.type;
                    })()
                }</h2>
                <div className="w-full">
                    <TabGroup defaultIndex={defaultIndex}>
                        <TabList className="flex flex-wrap gap-1 px-1 pb-2 rounded-xl px-2" id="categories-bar">
                            {categories.map(([catName]) => (
                                <Tab
                                    key={catName}
                                    className={({ selected }) =>
                                        [
                                            'px-2 py-1 text-xs font-semibold rounded-lg border transition',
                                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30',
                                            selected
                                                ? 'bg-white/20 text-white  shadow-sm'
                                                : 'bg-transparent text-stone-400  hover:bg-white/10 hover:text-stone-200 hover:border-white/20 hover:shadow-xs hover:cursor-pointer',
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
                                    className="rounded-xl"
                                >
                                    {catProperties.map((p: any) => (
                                        <PropertyField key={el.id + p.ns.prefix + ':' + p.ns.name} bpmnProperty={p} />
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
            <div className={`fixed w-80 px-1 top-4 right-4 bg-black/50 backdrop-blur-xs rounded-2xl text-stone-200 `
                + (isVisible ? '' : 'hidden')}>
                {element && renderCategories(element) }
            </div>
        </InspectorContext.Provider>
    )

}
