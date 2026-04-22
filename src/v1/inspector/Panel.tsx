
import { useContext, useEffect, useState, useCallback, useRef } from 'react';
import { ModelerContext, InspectorContext } from '../contexts';

import { getBusinessObject, is } from 'bpmn-js/lib/util/ModelUtil';
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react';
import { PropertyField, isPropertyVisible } from './field';
import { t } from '../../i18n';
import { ToggleButton } from './ToggleButton';
import {
    getAppliedStudyflowType,
    getBusinessObjectPropertyDescriptor,
    getElementProperties,
    getExtensionElement,
    getExtensionElementProperties,
    getRedefinedPropertyName,
    getProperty,
    isExtensionPrefix,
} from '../extensionElements';

const toLocalName = (name: string | undefined) => {
    if (!name) return undefined;
    const idx = name.indexOf(':');
    return idx === -1 ? name : name.slice(idx + 1);
};

const isIdentityProperty = (prop: any) => {
    const name = prop?.ns?.name ?? prop?.name;
    const localName = prop?.ns?.localName ?? toLocalName(name);

    return prop?.isId
        || name === 'bpmn:id'
        || name === 'bpmn:name'
        || localName === 'id'
        || localName === 'name';
};

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
        let propsByCategory: Record<string, any[]> = {};
        const businessObject = getBusinessObject(element);
        const extensionProperties = getExtensionElementProperties(element);
        const seen = new Set<string>();
        const overriddenBusinessProperties = new Set(
            extensionProperties
                .map((prop: any) => getRedefinedPropertyName(prop) ?? prop.ns?.localName ?? prop.name)
                .filter((name: string | undefined): name is string => Boolean(name))
        );
        const identityProperties = [
            getBusinessObjectPropertyDescriptor(businessObject, 'bpmn:id'),
            getBusinessObjectPropertyDescriptor(businessObject, 'bpmn:name'),
        ].filter((prop: any) => Boolean(prop));

        const collectProperties = (properties: any[], predicate: (prop: any) => boolean) => {
            properties.forEach((prop: any) => {
                if (!predicate(prop)) return;
                if (!isPropertyVisible(prop, element)) return;

                const propKey = prop.ns?.name ?? prop.name;
                if (seen.has(propKey)) return;
                seen.add(propKey);

                (prop.meta?.categories ?? ["General"]).forEach((cat: string | number) => {
                    (propsByCategory[cat] ??= []).push(prop);
                });
            });
        };

        collectProperties(identityProperties, () => true);

        collectProperties(getElementProperties(businessObject), (prop: any) => (
            !overriddenBusinessProperties.has(prop.ns?.localName ?? prop.name)
            && !isIdentityProperty(prop)
            && (
                isExtensionPrefix(prop.ns?.prefix)
            )
        ));

        collectProperties(extensionProperties, (prop: any) => (
            isExtensionPrefix(prop.ns?.prefix)
        ));

        // Sort by meta.order within each category; properties without order keep relative position
        for (const props of Object.values(propsByCategory)) {
            props.sort((a: any, b: any) => {
                const orderA = a.meta?.order ?? Infinity;
                const orderB = b.meta?.order ?? Infinity;
                return orderA - orderB;
            });
        }

        // remove empty groups and return
        return Object.fromEntries(
            Object.entries(propsByCategory).filter(([, v]) => v.length > 0)
        );

    }, []);

    const syncCategoriesBar = useCallback((element: any, shouldRender: boolean) => {
        if (!element) {
            categoryBarRef.current = '';
            return;
        }
        const categories = getProperties(element);
        const renderSignature = Object.entries(categories)
            .map(([catName, props]) => `${catName}:${props.map((p: any) => p.ns.name).join(',')}`)
            .join('|');
        if (renderSignature === categoryBarRef.current) {
            return;
        }
        categoryBarRef.current = renderSignature;
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
                <h1 className="pb-0 text-[15px] font-bold p-2 pb-0 text-stone-800">{
                    (() => {
                                                const businessObject = getBusinessObject(el);
                                                const extension = getExtensionElement(el);
                                                const resolvedName = getProperty(el, 'name')
                                                    ?? extension?.get?.('name')
                                                    ?? extension?.name;
                                                if (typeof resolvedName === 'string' && resolvedName.trim()) {
                                                    return resolvedName;
                                                }

                                                const fallbackType = getAppliedStudyflowType(el) || businessObject?.$type || el?.type;
                                                if (typeof fallbackType === 'string' && fallbackType.includes(':')) {
                                                    return fallbackType.split(':')[1];
                                                }
                                                return fallbackType || 'Unknown';
                    })()
                }</h1>
                <h2 className="text-[10.5px] text-left font-mono px-2 pb-2 text-stone-400">{
                    (() => {
                        const businessObject = getBusinessObject(el);
                        return getAppliedStudyflowType(el) || businessObject?.$type || el.type;
                    })()
                }</h2>
                <div className="w-full">
                    <TabGroup defaultIndex={defaultIndex}>
                        <TabList className="flex flex-wrap gap-1 px-2 pb-2 border-b border-black/6" id="categories-bar">
                            {categories.map(([catName]) => (
                                <Tab
                                    key={catName}
                                    className={({ selected }) =>
                                        [
                                            'px-2.5 py-1 text-[12px] font-semibold rounded-md transition-all',
                                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-black/20',
                                            selected
                                                ? 'bg-stone-900 text-white shadow-sm'
                                                : 'text-stone-500 hover:bg-black/6 hover:text-stone-700 cursor-pointer',
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
            <div data-testid="inspector-root" className={`fixed w-72 top-1/2 -translate-y-1/2 right-2.5
                rounded-[14px] bg-white/55 backdrop-blur-2xl
                border border-white/45
                shadow-[0_2px_8px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.07),inset_0_1px_0_rgba(255,255,255,0.85)]
                text-stone-800 max-h-[calc(100vh-72px)] overflow-y-auto `
                + (isVisible ? '' : 'hidden')}>
                {element && renderCategories(element) }
            </div>
        </InspectorContext.Provider>
    )

}
