/**
 * A study started from a question: what is being built, and which of its parts (the skills' starters, `skillModules.ts`).
 * The parts' skills are turned on, a new study opens, and their steps follow its start event in the order the parts
 * give, then an end. Templates do it, not a model: the result is the same each time.
 */

import { executeCommand } from '@modeler/commandBus';
import { turnOnSchemas } from '@modeler/app/skills';
import type { Editor } from '@modeler/editor/port';
import { addEntries } from '@modeler/palette/catalog';
import { newShape } from '@modeler/palette/newShape';
import { SKILL_STARTERS, type StarterIntent, type StarterStep } from '@modeler/skillModules';

export type OfferedStarter = (typeof SKILL_STARTERS)[number];

export const INTENTS: readonly { id: StarterIntent; label: string; icon: string }[] = [
  { id: 'experiment', label: 'An experiment', icon: 'iconify tabler--flask' },
  { id: 'analysis', label: 'An analysis', icon: 'iconify tabler--chart-dots' },
  { id: 'robot', label: 'A robot or an agent', icon: 'iconify tabler--robot' },
];

/** The parts offered for `intent`, in session order. */
export function startersFor(intent: StarterIntent): OfferedStarter[] {
  return SKILL_STARTERS.filter((starter) => starter.intent === intent).sort((a, b) => a.order - b.order);
}

/** A step as the study adds it: a skill's type the way the Add panel adds it, named. */
function shapeOf(step: StarterStep) {
  const entry = step.extension ? addEntries().find((candidate) => candidate.extensionType === step.extension) : undefined;
  const shape = entry
    ? newShape(entry.bpmnType, entry.extensionType, { ...entry.attributes, ...step.attributes })
    : newShape(step.type ?? 'bpmn:Task', undefined, step.attributes);
  return { ...shape, name: step.name };
}

/** Start a study of `parts`, on the editor that holds the study once their skills are on. Returns that editor. */
export async function startFrom(editor: Editor, parts: readonly OfferedStarter[]): Promise<Editor> {
  const ordered = [...parts].sort((a, b) => a.order - b.order);
  const current = (await turnOnSchemas([...new Set(ordered.flatMap((part) => part.schemas))])) ?? editor;
  await executeCommand(current, { type: 'NewDiagram' });
  let from = current.study.list({ kind: 'node' }).find((record) => record.type === 'bpmn:StartEvent')?.id;
  for (const shape of [...ordered.flatMap((part) => part.steps.map(shapeOf)), { type: 'bpmn:EndEvent', name: 'Done' }]) {
    if (!from) break;
    const made = current.study.append({ ...shape, from });
    from = made.ok ? made.id : undefined;
  }
  current.canvas.select([]);
  current.canvas.zoom('fit');
  return current;
}
