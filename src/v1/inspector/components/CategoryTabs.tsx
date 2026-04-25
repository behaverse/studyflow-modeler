import { Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react';
import { PropertyField } from '../field';
import { t } from '../../../i18n';

type Props = {
  element: any;
  categories: [string, any[]][];
};

/**
 * HeadlessUI tab group rendering one property list per category.
 * Defaults to the `General` tab when present.
 */
export function CategoryTabs({ element, categories }: Props) {
  const defaultIndex = Math.max(
    0,
    categories.findIndex(([catName]) => catName === 'General'),
  );

  return (
    <TabGroup defaultIndex={defaultIndex}>
      <TabList
        className="flex flex-wrap gap-1 px-2 pb-2 border-b border-white/10"
        id="categories-bar"
      >
        {categories.map(([catName]) => (
          <Tab
            key={catName}
            className={({ selected }) =>
              [
                'px-2.5 py-1 text-[12px] font-semibold rounded-md transition-all',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20',
                selected
                  ? 'bg-white/15 text-white shadow-sm'
                  : 'text-stone-400 hover:bg-white/10 hover:text-stone-200 cursor-pointer',
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
