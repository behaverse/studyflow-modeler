import { useSelectedNode, useSelectedEdge, useProcessBusinessObject } from '../store/selectors';
import {
  getAppliedStudyflowType,
  getProperty,
  getElementProperties,
  getExtensionElementProperties,
  getRedefinedPropertyName,
  getBusinessObjectPropertyDescriptor,
  isExtensionPrefix,
} from '../../shared/extensionElements';
import { getBusinessObject } from '../model/businessObject';
import { useState } from 'react';
import { useModelerStore } from '../store';
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react';
import { PropertyField } from './PropertyField';
import { t } from '../../i18n';

const toLocalName = (name: string | undefined) => {
  if (!name) return undefined;
  const idx = name.indexOf(':');
  return idx === -1 ? name : name.slice(idx + 1);
};

const isIdentityProperty = (prop: any) => {
  const name = prop?.ns?.name ?? prop?.name;
  const localName = prop?.ns?.localName ?? toLocalName(name);
  return (
    prop?.isId ||
    name === 'bpmn:id' ||
    name === 'bpmn:name' ||
    localName === 'id' ||
    localName === 'name'
  );
};

/** Check if a property is visible based on its condition. */
export function isPropertyVisible(bProp: any, el: any): boolean {
  if (!bProp || !el) return true;
  if (bProp.meta?.hidden) return false;
  if (!bProp.meta?.condition) return true;

  const conditions = bProp.meta?.condition?.body || {};
  return Object.entries(conditions).every(([cKey, cExpectedVal]) => {
    const cVal = getProperty(el, cKey);
    if (Array.isArray(cExpectedVal)) {
      return (cExpectedVal as any[]).includes(cVal);
    }
    return cVal === cExpectedVal;
  });
}

function getPropertiesByCategory(element: any): Record<string, any[]> {
  const bo = getBusinessObject(element);
  const propsByCategory: Record<string, any[]> = {};
  const extensionProperties = getExtensionElementProperties(bo);
  const seen = new Set<string>();

  const overridden = new Set(
    extensionProperties
      .map((p: any) => getRedefinedPropertyName(p) ?? p.ns?.localName ?? p.name)
      .filter(Boolean),
  );

  const identityProps = [
    getBusinessObjectPropertyDescriptor(bo, 'bpmn:id'),
    getBusinessObjectPropertyDescriptor(bo, 'bpmn:name'),
  ].filter(Boolean);

  const collect = (properties: any[], predicate: (p: any) => boolean) => {
    for (const prop of properties) {
      if (!predicate(prop)) continue;
      if (!isPropertyVisible(prop, bo)) continue;
      const key = prop.ns?.name ?? prop.name;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const cat of prop.meta?.categories ?? ['General']) {
        (propsByCategory[cat] ??= []).push(prop);
      }
    }
  };

  collect(identityProps, () => true);
  collect(getElementProperties(bo), (p: any) =>
    !overridden.has(p.ns?.localName ?? p.name) &&
    !isIdentityProperty(p) &&
    isExtensionPrefix(p.ns?.prefix),
  );
  collect(extensionProperties, (p: any) => isExtensionPrefix(p.ns?.prefix));

  return Object.fromEntries(
    Object.entries(propsByCategory).filter(([, v]) => v.length > 0),
  );
}

export function InspectorPanel() {
  const selectedNode = useSelectedNode();
  const selectedEdge = useSelectedEdge();
  const processBO = useProcessBusinessObject();
  const modelVersion = useModelerStore((s) => s._modelVersion);
  const selectedNodeIds = useModelerStore((s) => s.selectedNodeIds);
  const removeElements = useModelerStore((s) => s.removeElements);
  const [isVisible, setIsVisible] = useState(true);

  // Multi-selection: show count + bulk delete
  if (selectedNodeIds.length > 1) {
    return (
      <>
        <button
          onClick={() => setIsVisible(!isVisible)}
          className="absolute right-2 top-2 m-2 text-white/50 hover:text-white/80 active:text-white rounded-xl z-50"
          title={isVisible ? 'Hide Inspector' : 'Show Inspector'}
        >
          <i className={`text-[32px] ${isVisible
            ? 'iconify tabler--layout-sidebar-right-collapse-filled'
            : 'iconify tabler--layout-sidebar-right-expand-filled'}`}
          />
        </button>
        {isVisible && (
          <div className="fixed w-80 px-4 py-4 top-2 right-2 bg-black/50 backdrop-blur-xs rounded-2xl text-stone-200">
            <h1 className="text-lg font-bold text-stone-100 mb-1">
              {selectedNodeIds.length} elements selected
            </h1>
            <button
              className="mt-2 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/40 text-red-300 text-sm"
              onClick={() => removeElements(selectedNodeIds)}
            >
              <i className="bi bi-trash" /> Delete all
            </button>
          </div>
        )}
      </>
    );
  }

  const inspectTarget =
    selectedNode?.data ??
    selectedEdge?.data ??
    (processBO ? { businessObject: processBO, id: processBO?.id } : null);

  if (!inspectTarget) return null;

  const bo = getBusinessObject(inspectTarget);
  const sfType = getAppliedStudyflowType(bo);
  const displayName =
    getProperty(bo, 'name') || (sfType?.includes(':') ? sfType.split(':')[1] : bo?.$type) || 'Unknown';
  const typeName = sfType || bo?.$type || '';
  const categories = Object.entries(getPropertiesByCategory(bo));
  const defaultIndex = Math.max(0, categories.findIndex(([catName]) => catName === 'General'));

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setIsVisible(!isVisible)}
        className="absolute right-2 top-2 m-2 text-white/50 hover:text-white/80 active:text-white rounded-xl z-50"
        title={isVisible ? 'Hide Inspector' : 'Show Inspector'}
      >
        <i className={`text-[32px] ${isVisible
          ? 'iconify tabler--layout-sidebar-right-collapse-filled'
          : 'iconify tabler--layout-sidebar-right-expand-filled'}`}
        />
      </button>

      <div
        key={`${bo?.id ?? ''}-${modelVersion}`}
        data-testid="inspector-root"
        className={`fixed w-80 px-1 top-2 right-2 bg-black/50 backdrop-blur-xs rounded-2xl text-stone-200 max-h-[90vh] overflow-y-auto ${
          isVisible ? '' : 'hidden'
        }`}
      >
        <h1 className="pb-0 text-lg font-bold p-2 rounded-2xl text-stone-100">
          {displayName}
        </h1>
        <h2 className="text-xs text-left italic font-mono px-2 pb-2 text-stone-300">
          {typeName}
        </h2>
        <div className="w-full">
          <TabGroup defaultIndex={defaultIndex}>
            <TabList className="flex flex-wrap gap-1 px-1 pb-2 rounded-xl px-2">
              {categories.map(([catName]) => (
                <Tab
                  key={catName}
                  className={({ selected }) =>
                    [
                      'px-2 py-1 text-xs font-semibold rounded-lg border transition',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30',
                      selected
                        ? 'bg-white/20 text-white shadow-sm'
                        : 'bg-transparent text-stone-400 hover:bg-white/10 hover:text-stone-200 hover:border-white/20 hover:shadow-xs hover:cursor-pointer',
                    ].join(' ')
                  }
                >
                  {t(catName)}
                </Tab>
              ))}
            </TabList>
            <TabPanels className="p-1">
              {categories.map(([catName, catProperties]) => (
                <TabPanel key={catName} className="rounded-xl">
                  {catProperties.map((p: any) => (
                    <PropertyField
                      key={`${bo?.id}-${p.ns?.prefix}:${p.ns?.name ?? p.name}`}
                      bpmnProperty={p}
                      businessObject={bo}
                      elementId={inspectTarget.id ?? bo?.id}
                    />
                  ))}
                </TabPanel>
              ))}
            </TabPanels>
          </TabGroup>
        </div>
      </div>
    </>
  );
}
