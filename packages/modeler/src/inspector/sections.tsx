/**
 * The inspector's sections: what a tab shows below its attribute fields. Each files under a tab, a category the
 * schemas declare, and draws for the inspected element when it applies to it, nothing otherwise. The modeler's own
 * are listed here; a skill adds more in its `modeler.ts` (`sections`).
 */
import type { ComponentType } from 'react';
import { DataFlowSection } from '@modeler/inspector/dataFlow';
import { LoopSection } from '@modeler/inspector/loop';
import { MessageSection } from '@modeler/inspector/message';
import { ChoreographyParticipantsSection } from '@modeler/inspector/participants';
import { StateSection } from '@modeler/inspector/state';
import { WireTransformationSection } from '@modeler/inspector/transformation';
import { SKILL_INSPECTOR_SECTIONS } from '@modeler/skillModules';

export type InspectorSection = {
  /** Unique among the sections. */
  name: string;
  /** The category, as the schemas name it, whose tab shows the section. */
  tab: string;
  Section: ComponentType<{ element: any }>;
};

const OWN: InspectorSection[] = [
  { name: 'state', tab: 'Execution', Section: StateSection },
  { name: 'inputs', tab: 'Execution', Section: () => <DataFlowSection direction="input" /> },
  { name: 'outputs', tab: 'Execution', Section: () => <DataFlowSection direction="output" /> },
  { name: 'loop', tab: 'Execution', Section: LoopSection },
  { name: 'participants', tab: 'General', Section: ChoreographyParticipantsSection },
  { name: 'transformation', tab: 'General', Section: WireTransformationSection },
  { name: 'message', tab: 'General', Section: MessageSection },
];

/** Every section, in the order a tab shows them: the modeler's, then the skills'. */
export const INSPECTOR_SECTIONS: readonly InspectorSection[] = [...OWN, ...SKILL_INSPECTOR_SECTIONS];
