import { createElement, useState } from 'react';
import type { ComponentType } from 'react';
import { Field, Label, Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react';
import type { AttributeSpec } from '@core/notation';
import { t } from '@modeler/i18n';
import { executeCommand } from '@modeler/commandBus';
import { useRequiredModeler } from '@modeler/app/useModeler';
import { useInspectedElement } from '@modeler/inspector/state';
import { isAttributeVisible } from '@modeler/inspector/categories';
import { elementKey } from '@modeler/inspector/element';
import { pickInput } from '@modeler/inspector/registry';
import { ExpressionRow } from '@modeler/inspector/inputs';
import { HelpTooltip } from '@modeler/inspector/widgets';
import {
  ChoreographyParticipantsSection,
  DataFlowSection,
  LoopSection,
  StateSection,
} from '@modeler/inspector/sections';
import { inspector as s, field as fld } from '@modeler/inspector/styles';

function AttributeFields({ attrDefs }: { attrDefs: any[] }) {
  const element = useInspectedElement();
  return (
    <>
      {attrDefs.map((attrDef: AttributeSpec) => (
        <AttributeField key={`${elementKey(element)}:${attrDef.ns.prefix}:${attrDef.ns.name}`} attrDef={attrDef} />
      ))}
    </>
  );
}

function AttributeField({ attrDef }: { attrDef: AttributeSpec }) {
  const element = useInspectedElement();

  if (!isAttributeVisible(attrDef, element)) return null;

  // `createElement` rather than a capitalized local: react-hooks would read the latter as a component defined during render.
  return (
    <Field className={fld.field}>
      {createElement(pickInput(attrDef), { attrDef })}
    </Field>
  );
}

function ExecutionSection({ attrDefs }: { attrDefs: any[] }) {
  return (
    <>
      <AttributeFields attrDefs={attrDefs} />
      <StateSection />
      <DataFlowSection direction="input" />
      <DataFlowSection direction="output" />
      <LoopSection />
    </>
  );
}

const TRANSFORMATION_DESCRIPTION = 'The association’s one expression — BPMN’s own '
  + 'transformation element. Its body is `slot = selection`, each half optional: '
  + 'the slot names which callable parameter the value fills, the selection '
  + 'narrows what value arrives (member access and indexing only — wires '
  + 'coordinate, steps calculate). On an output the drawn target is the slot, '
  + 'so the body is a selection over `result`.';

const ASSOCIATION_TYPES = new Set(['bpmn:DataInputAssociation', 'bpmn:DataOutputAssociation']);

function WireTransformationSection({ element }: { element: any }) {
  const modeler = useRequiredModeler();
  const businessObject = element?.businessObject ?? element;
  if (!ASSOCIATION_TYPES.has(businessObject?.$type)) return null;

  const expression = businessObject.get?.('transformation') ?? businessObject.transformation;
  const body: string = expression?.get?.('body') ?? expression?.body ?? '';
  const language: string = expression?.get?.('language') ?? expression?.language ?? '';
  const isOutput = businessObject.$type === 'bpmn:DataOutputAssociation';
  const source = businessObject.get?.('sourceRef')?.[0] ?? businessObject.sourceRef?.[0];
  const placeholder = isOutput ? 'result' : source?.name || source?.id || 'input';

  return (
    <Field className={fld.field}>
      <Label className={fld.label}>
        Transformation
        <HelpTooltip name="transformation" description={TRANSFORMATION_DESCRIPTION} />
      </Label>
      <ExpressionRow
        name="bpmn:transformation"
        placeholder={placeholder}
        value={body}
        language={language}
        onCommit={(next) => executeCommand(modeler, {
          type: 'UpdateTransformation', element, field: 'body', value: next,
        })}
        onCommitLanguage={(next) => executeCommand(modeler, {
          type: 'UpdateTransformation', element, field: 'language', value: next,
        })}
      />
    </Field>
  );
}

type SectionProps = { attrDefs: any[] };
type ExtraSectionProps = { element: any };

const TAB_SECTIONS: Record<string, {
  replace?: ComponentType<SectionProps>;
  extras?: ComponentType<ExtraSectionProps>[];
}> = {
  Execution: { replace: ExecutionSection },
  General: { extras: [ChoreographyParticipantsSection, WireTransformationSection] },
};

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
          const sections = TAB_SECTIONS[name];
          return (
            <TabPanel key={name} className={s.tabPanel}>
              {sections?.replace
                ? <sections.replace key={elementKey(element)} attrDefs={attrDefs} />
                : <AttributeFields attrDefs={attrDefs} />}
              {sections?.extras?.map((Extra) => (
                <Extra key={Extra.name} element={element} />
              ))}
            </TabPanel>
          );
        })}
      </TabPanels>
    </TabGroup>
  );
}
