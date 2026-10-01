import { useState } from 'react';
import { Field, Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react';
import { attributeOverridesIn, type AttributeOverride } from '@core/model/parameters';
import type { AttributeSpec } from '@core/notation';
import { t } from '@modeler/i18n';
import { useInspectedElement, useInspectedModel } from '@modeler/inspector/hooks';
import { isAttributeVisible } from '@modeler/inspector/categories';
import { elementKey } from '@modeler/inspector/element';
import { AttributeInput, OverriddenInput } from '@modeler/inspector/registry';
import { INSPECTOR_SECTIONS } from '@modeler/inspector/sections';
import { inspector as s, field as fld } from '@modeler/inspector/styles';

function AttributeFields({ attrDefs }: { attrDefs: any[] }) {
  const element = useInspectedElement();
  const model = useInspectedModel();
  // What the Parameters wired into the element set on it.
  const overrides = element ? attributeOverridesIn(model, element) : new Map<string, AttributeOverride>();
  return (
    <>
      {attrDefs.map((attrDef: AttributeSpec) => (
        <AttributeField
          key={`${elementKey(element)}:${attrDef.ns.prefix}:${attrDef.ns.name}`}
          attrDef={attrDef}
          override={attrDef.isAttr ? overrides.get(attrDef.ns.localName) : undefined}
        />
      ))}
    </>
  );
}

function AttributeField({ attrDef, override }: { attrDef: AttributeSpec; override?: AttributeOverride }) {
  const element = useInspectedElement();
  const model = useInspectedModel();

  if (!isAttributeVisible(model, attrDef, element)) return null;

  return (
    <Field className={fld.field}>
      {override ? <OverriddenInput attrDef={attrDef} override={override} /> : <AttributeInput attrDef={attrDef} />}
    </Field>
  );
}

type Props = {
  element: any;
  categories: [string, any[]][];
};

export function CategoryTabs({ element, categories }: Props) {
  const [selectedName, setSelectedName] = useState<string>('General');

  const indexOf = (name: string) => categories.findIndex(([categoryName]) => categoryName === name);
  const namedIndex = indexOf(selectedName);
  const selectedIndex = namedIndex !== -1 ? namedIndex : Math.max(0, indexOf('General'));

  return (
    <TabGroup
      selectedIndex={selectedIndex}
      onChange={(categoryIndex) => setSelectedName(categories[categoryIndex]?.[0] ?? 'General')}
    >
      <TabList className={s.tabList} id="categories-bar">
        {categories.map(([name]) => (
          <Tab
            key={name}
            className={({ selected }) =>
              `${s.tabBase} ${selected ? s.tabSelected : s.tabUnselected}`
            }
          >
            {t(name)}
          </Tab>
        ))}
      </TabList>
      <TabPanels className={s.tabPanels}>
        {categories.map(([name, attrDefs]) => {
          return (
            <TabPanel key={name} className={s.tabPanel}>
              <AttributeFields attrDefs={attrDefs} />
              {INSPECTOR_SECTIONS.filter((section) => section.tab === name).map(({ name: section, Section }) => (
                <Section key={`${section}:${elementKey(element)}`} element={element} />
              ))}
            </TabPanel>
          );
        })}
      </TabPanels>
    </TabGroup>
  );
}
