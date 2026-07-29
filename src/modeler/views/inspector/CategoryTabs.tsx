import { useState } from 'react';
import type { ComponentType } from 'react';
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react';
import { AttributeField } from '@/modeler/views/inspector/AttributeField';
import { LoopSection } from '@/modeler/views/inspector/LoopSection';
import { ExecutionSection } from '@/modeler/views/inspector/ExecutionSection';
import { t } from '@/i18n';
import { inspector as s } from '@/modeler/infra/styles';

/** Synthetic categories render a dedicated section over nested model state
 *  instead of catalog attribute fields. Execution renders both its sections
 *  (properties, then data associations) above its own attribute fields. */
const SECTION_BY_CATEGORY: Record<string, ComponentType> = {
  Loop: LoopSection,
  Execution: ExecutionSection,
};

type Props = {
  element: any;
  categories: [string, any[]][];
};

/** One tab per category; defaults to `General` and falls back to it when the prior tab is gone. */
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
          const Section = SECTION_BY_CATEGORY[name];
          return (
            <TabPanel key={name} className={s.tabPanel}>
              {Section && <Section key={element.id} />}
              {attrDefs.map((attrDef: any) => (
                <AttributeField
                  key={element.id + attrDef.ns.prefix + ':' + attrDef.ns.name}
                  attrDef={attrDef}
                />
              ))}
            </TabPanel>
          );
        })}
      </TabPanels>
    </TabGroup>
  );
}
