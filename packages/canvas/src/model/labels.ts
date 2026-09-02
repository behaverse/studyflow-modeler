/**
 * Label elements: minted for every named element whose caption is drawn beside it,
 * kept in step with the owner's name and geometry.
 */

import { BPMN } from '@core/constants.ts';

import { nameOf } from '@canvas/model/moddle.ts';
import type { Bounds, Scene, SceneEdge, SceneLabel, SceneNode } from '@canvas/model/scene.ts';
import { edgeLabelBox, labelHeightFor, nodeLabelBox } from '@canvas/render/labels.ts';
import { DATA_TYPES } from '@canvas/rules/rules.ts';

const EXTERNAL_LABEL_TYPES = new Set<string>([
  BPMN.StartEvent, BPMN.EndEvent, BPMN.IntermediateThrowEvent, BPMN.IntermediateCatchEvent,
  BPMN.BoundaryEvent, BPMN.ExclusiveGateway, BPMN.ParallelGateway, BPMN.InclusiveGateway,
  BPMN.ComplexGateway, BPMN.EventBasedGateway, ...DATA_TYPES,
]);

/** Whether an element's name is drawn beside it rather than inside it. */
export function hasExternalLabel(element: SceneNode | SceneEdge): boolean {
  return element.kind === 'edge' || EXTERNAL_LABEL_TYPES.has(element.type);
}

export function labelIdOf(owner: { id: string }): string {
  return `${owner.id}_label`;
}

function derivedBox(owner: SceneNode | SceneEdge, name: string): Bounds {
  return owner.kind === 'node' ? nodeLabelBox(owner, name) : edgeLabelBox(owner, name);
}

/**
 * Bring `owner`'s label in line with its name and geometry: minted when a caption
 * appears, dropped when it goes, re-derived while unpinned, re-wrapped when pinned.
 * Returns the label, or `undefined` when the owner draws none.
 */
export function syncLabel(scene: Scene, owner: SceneNode | SceneEdge): SceneLabel | undefined {
  const name = nameOf(owner.businessObject);
  if (!name || !hasExternalLabel(owner)) {
    dropLabel(scene, owner);
    return undefined;
  }
  let label = owner.label;
  if (!label) {
    label = mintLabel(owner, derivedBox(owner, name), false);
    scene.elementsById.set(label.id, label);
  }
  label.parent = owner.parent;
  label.type = owner.type;
  label.businessObject = owner.businessObject;
  if (label.pinned) {
    label.height = labelHeightFor(name, label.width);
  } else {
    Object.assign(label, derivedBox(owner, name));
  }
  return label;
}

/** A label at `box`; `pinned` when the box came from the document or a drag. */
export function mintLabel(owner: SceneNode | SceneEdge, box: Bounds, pinned: boolean): SceneLabel {
  const label: SceneLabel = {
    id: labelIdOf(owner),
    kind: 'label',
    type: owner.type,
    businessObject: owner.businessObject,
    parent: owner.parent,
    owner,
    pinned,
    ...box,
  };
  owner.label = label;
  return label;
}

export function dropLabel(scene: Scene, owner: SceneNode | SceneEdge): SceneLabel | undefined {
  const label = owner.label;
  if (!label) return undefined;
  owner.label = undefined;
  if (scene.elementsById.get(label.id) === label) scene.elementsById.delete(label.id);
  return label;
}
