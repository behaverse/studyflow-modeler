import { useState } from 'react';
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react';
import { PropertyField } from './field';
import { t } from '../../i18n';
import { inspector as s } from '../styles';

type Props = {
  element: any;
  categories: [string, any[]][];
};

/**
 * tab group rendering one property list per category.
 * Defaults to the `General` tab when present, and falls back to it when the
 * previously selected category is not available for the current element.
 */
export function CategoryTabs({ element, categories }: Props) {
  const [selectedName, setSelectedName] = useState<string>('General');

  const generalIndex = Math.max(
    0,
    categories.findIndex(([catName]) => catName === 'General'),
  );
  const namedIndex = categories.findIndex(([catName]) => catName === selectedName);
  const selectedIndex = namedIndex === -1 ? generalIndex : namedIndex;

  return (
    <TabGroup
      selectedIndex={selectedIndex}
      onChange={(i) => setSelectedName(categories[i]?.[0] ?? 'General')}
    >
      <TabList className={s.tabList} id="categories-bar">
        {categories.map(([catName]) => (
          <Tab
            key={catName}
            className={({ selected }) =>
              `${s.tabBase} ${selected ? s.tabSelected : s.tabUnselected}`
            }
          >
            {t(catName)}
          </Tab>
        ))}
      </TabList>
      <TabPanels className={s.tabPanels}>
        {categories.map(([catName, catProperties]) => (
          <TabPanel key={catName} className={s.tabPanel}>
            {catProperties.map((p: any) => (
              <PropertyField
                key={element.id + p.ns.prefix + ':' + p.ns.name}
                bpmnProperty={p}
              />
            ))}
          </TabPanel>
        ))}
      </TabPanels>
    </TabGroup>
  );
}
