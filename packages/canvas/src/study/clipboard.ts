/**
 * Copy and paste. A copy is a `.studyflow.yaml` document of its own: the shapes asked for with what they hold and
 * what sits on them, the flows between them, and their drawing, with no reference to what stayed behind. A paste
 * draws such a document (a copy, or any file's process) on its own first, its ids clear of the study's, for the
 * mutator to graft in.
 */

import { isDataAssociationType } from '@core/element/index.ts';
import { StudyModel, type Element, type Value } from '@core/model/index.ts';
import { readStudy, studyText } from '@core/model/yaml.ts';
import { isBpmnSubtypeOf } from '@core/notation/bpmn.ts';

import { drawingOf } from '@canvas/study/di.ts';
import { listOf, refOf } from '@canvas/study/elements.ts';
import type { IdGenerator } from '@canvas/study/ids.ts';
import { importStudy } from '@canvas/study/import.ts';
import type { Scene, SceneEdge, SceneNode } from '@canvas/study/scene.ts';
import { renameClashes } from '@canvas/study/templates.ts';
import { hostOf } from '@canvas/study/tree.ts';

/** What a copy leaves behind, and a paste does not take: they frame a diagram rather than sit in it. */
const FRAMES = new Set(['bpmn:Participant', 'bpmn:Lane']);
const DATA_ASSOCIATIONS = ['dataInputAssociations', 'dataOutputAssociations'];

/**
 * A copy of the shapes `ids` name (a caption's names its owner) as `.studyflow.yaml` text: each with what it holds and
 * the boundary events on it, and the flows, associations and data associations between what it takes. Undefined when
 * `ids` name no shape it takes.
 */
export function copyOf(scene: Scene, ids: readonly string[]): string | undefined {
  const named = ids.map((id) => scene.elementsById.get(id)).map((element) => (element?.kind === 'label' ? element.owner : element));
  const chosen = new Set(named.filter((element): element is SceneNode => element?.kind === 'node' && !FRAMES.has(element.type)));
  // What sits on an activity goes with it, and never alone.
  for (const element of scene.elementsById.values()) {
    const host = element.kind === 'node' ? hostOf(scene, element) : undefined;
    if (host && chosen.has(host)) chosen.add(element as SceneNode);
    else if (host) chosen.delete(element as SceneNode);
  }
  const top = [...chosen].filter((node) => !ancestorsOf(node).some((ancestor) => chosen.has(ancestor)));
  if (top.length === 0) return undefined;

  const held = new Set<SceneNode>();
  const hold = (node: SceneNode): void => {
    held.add(node);
    for (const child of node.children) if (child.kind === 'node') hold(child);
  };
  top.forEach(hold);
  const flows = [...scene.elementsById.values()].filter((element): element is SceneEdge => element.kind === 'edge'
    && !isBpmnSubtypeOf(element.type, 'bpmn:MessageFlow') && held.has(element.source!) && held.has(element.target!));
  // A flow inside a shape the copy holds goes with that shape; a data association with its activity.
  const topFlows = flows.filter((flow) => !(flow.parent && held.has(flow.parent)) && !isDataAssociationType(flow.type));

  const { model } = scene;
  const isArtifact = (element: SceneNode | SceneEdge): boolean => isBpmnSubtypeOf(element.type, 'bpmn:Artifact');
  // A data association to data left behind stays behind: set aside while the copy is taken.
  const taken = new Set<Element>(flows.map((flow) => flow.element));
  const aside: [Element, string, Value | undefined][] = [];
  for (const node of held) {
    for (const name of DATA_ASSOCIATIONS) {
      const list = listOf(node.element, name);
      if (list.every((association) => taken.has(association))) continue;
      aside.push([node.element, name, node.element[name]]);
      node.element[name] = list.filter((association) => taken.has(association));
    }
  }
  let elements: Element[];
  try {
    elements = structuredClone([...top, ...topFlows].map((element) => element.element));
  } finally {
    for (const [owner, name, list] of aside) owner[name] = list;
  }
  const kept = [...top, ...topFlows];
  const process: Element = {
    type: 'bpmn:Process',
    id: 'Copy',
    isExecutable: false,
    flowElements: elements.filter((_, i) => !isArtifact(kept[i])),
    artifacts: elements.filter((_, i) => isArtifact(kept[i])),
  };
  // A group's name is its category's value: the category comes along.
  const categories = new Set([...held].map((node) => {
    const value = refOf(model, node.element, 'categoryValueRef');
    return value && model.parentOf(value);
  }).filter((category): category is Element => !!category));
  const layout = Object.fromEntries([...held, ...flows].map((element) => [element.id, drawingOf(scene, element)]));
  return studyText({
    id: 'Copy_definitions',
    definitions: { targetNamespace: 'http://bpmn.io/schema/bpmn' },
    roots: [process, ...structuredClone([...categories])],
    layout,
  }, model.metamodel);
}

/**
 * `yaml`, a `.studyflow.yaml` document whose root is a process (a copy), drawn on its own, each id `model` holds
 * swapped for a fresh one from `ids`; a string says why it cannot be pasted.
 */
export function fragmentOf(yaml: string, model: StudyModel, ids: Pick<IdGenerator, 'nextPrefixed'>): Scene | string {
  let pasted: StudyModel;
  try {
    pasted = new StudyModel(readStudy(yaml, model.metamodel, () => {}), model.metamodel);
  } catch (error) {
    return `not a studyflow document: ${error instanceof Error ? error.message : String(error)}`;
  }
  renameClashes(pasted, model, ids);
  const fragment = importStudy(pasted, { onWarning: () => {} });
  if (!isBpmnSubtypeOf(fragment.rootElement.type, 'bpmn:Process')) return 'a paste takes shapes, not pools';
  if ([...fragment.elementsById.values()].some((element) => element.kind === 'node' && FRAMES.has(element.type))) return 'a paste takes shapes, not lanes';
  if (!fragment.rootElement.children.some((element) => element.kind === 'node')) return 'the document draws no shapes';
  return fragment;
}

function ancestorsOf(node: SceneNode): SceneNode[] {
  const out: SceneNode[] = [];
  for (let parent = node.parent; parent; parent = parent.parent) out.push(parent);
  return out;
}
