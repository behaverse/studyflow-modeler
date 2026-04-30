import { useState } from 'react';
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react';
import { PropertyField } from './field';
import { t } from '../../i18n';

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
      <TabList
        className="flex flex-wrap gap-1 px-2 pb-2 border-b border-[#b0a993]/40"
        id="categories-bar"
      >
        {categories.map(([catName]) => (
          <Tab
            key={catName}
            className={({ selected }) =>
              [
                'px-2.5 py-1 text-[12px] font-semibold rounded-md transition-all',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b0a993]',
                selected
                  ? 'bg-[#b0a993]/40 text-stone-900 shadow-sm'
                  : 'text-stone-500 hover:bg-[#b0a993]/25 hover:text-stone-800 cursor-pointer',
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
