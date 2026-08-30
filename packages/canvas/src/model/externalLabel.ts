/**
 * External labels as ELEMENTS (parity spec §2, "External label").
 *
 * bpmn-js does not draw a caption as decoration on the shape it belongs to: it
 * registers `<owner>_label` as its own element, with the OWNER's business object,
 * and that element is what a click selects, what gets the `x=-5 y=-5 w=textW+10
 * h=textH+10` outline, and what a double click opens the editor on. The canvas
 * draws the same `<g class="sf-external-label">` (`render/labels.ts`) — this module
 * is the model half: it mints the matching scene element, keeps its geometry in step
 * with the text, and answers "which label is under this point".
 *
 * Deliberately NOT part of {@link Scene.elementsById}: a label carries no business
 * object of its own, nothing writes it back, and putting it in the scene would hand
 * it to `Ctrl+A`, the lasso, the renderer's draw loop and the delete closure, none of
 * which have a use for it. It is a projection of its owner, minted lazily and
 * refreshed whenever the owner is re-drawn. The one field that makes it a label is
 * {@link SceneElementBase.labelTarget}, the same name diagram-js uses.
 */

import { isHiddenByCollapse } from '@canvas/model/expand.ts';
import { nameOf } from '@canvas/model/moddle.ts';
import type { Bounds, Point, Scene, SceneElement, SceneNode } from '@canvas/model/scene.ts';
import {
  edgeLabelTextBounds,
  externalLabelTextBounds,
  labelIdOf,
} from '@canvas/render/labels.ts';
import { categoryOf } from '@canvas/render/renderer.ts';
import { boxContains } from '@canvas/routing/crop.ts';

/** Whether `element` is the synthetic element of an external label. */
export function isLabelElement(element: SceneElement | undefined): boolean {
  return !!element?.labelTarget;
}

/** Whether a node's name is drawn BESIDE it (events, gateways, data shapes). */
export function hasExternalLabel(node: SceneNode): boolean {
  const category = categoryOf(node.type);
  return category === 'event' || category === 'gateway' || category === 'data';
}

/** The diagram-space text box of `owner`'s external label, when it draws one. */
export function labelBoundsOf(owner: SceneElement): Bounds | undefined {
  const name = nameOf(owner.businessObject);
  if (!name) return undefined;
  if (owner.kind === 'edge') return edgeLabelTextBounds(owner, name, owner.label);
  return hasExternalLabel(owner)
    ? externalLabelTextBounds(owner, name, owner.label)
    : undefined;
}

/**
 * The external-label elements of a scene, minted on demand and cached by id so the
 * selection can hold on to one across the re-draws a drag causes.
 */
export class ExternalLabels {
  private readonly cache = new Map<string, SceneNode>();

  /**
   * The label element of `owner`, refreshed to the text's current box — or
   * `undefined` when the owner draws no external label (no name, or a name drawn
   * inside the shape).
   */
  of(owner: SceneElement): SceneNode | undefined {
    const bounds = labelBoundsOf(owner);
    const id = labelIdOf(owner);
    if (!bounds) {
      this.cache.delete(id);
      return undefined;
    }
    const existing = this.cache.get(id);
    if (existing && existing.labelTarget === owner) {
      Object.assign(existing, bounds);
      existing.label = owner.label;
      // The owner may have GAINED a `bpmndi:BPMNLabel` since the element was minted
      // (a caption dragged for the first time, `Writeback.setLabelBounds`), so the
      // backing DI is re-read rather than frozen at creation.
      if (owner.label?.di) existing.di = owner.label.di;
      return existing;
    }
    const label: SceneNode = {
      id,
      kind: 'node',
      // The owner's type and business object, exactly as bpmn-js gives its label
      // element the owner's `businessObject`: everything downstream (the inspector,
      // the rules) then reads the element the caption names, which is what a user
      // means by clicking it. `labelTarget` is what says "this is the caption".
      type: owner.type,
      businessObject: owner.businessObject,
      labelTarget: owner,
      ...(owner.label?.di ? { di: owner.label.di } : {}),
      ...(owner.parent ? { parent: owner.parent } : {}),
      ...(owner.label ? { label: owner.label } : {}),
      ...bounds,
      children: [],
      incoming: [],
      outgoing: [],
    };
    this.cache.set(id, label);
    return label;
  }

  /** The label element for an id, if one has been minted and still has text. */
  byId(id: string): SceneNode | undefined {
    const label = this.cache.get(id);
    const owner = label?.labelTarget;
    return owner ? this.of(owner) : undefined;
  }

  /**
   * The topmost external label under a diagram-space `point`, or `undefined`.
   * Labels are small and sit clear of their shapes, so they are tested BEFORE the
   * shapes and edges (`interaction/hit.ts`) — a click on a caption is a click on the
   * caption, never on whatever it happens to overlap.
   */
  at(scene: Scene, point: Point): SceneNode | undefined {
    let found: SceneNode | undefined;
    for (const element of scene.elementsById.values()) {
      if (element.kind !== 'node' && element.kind !== 'edge') continue;
      // What a collapsed container hides draws no caption either.
      if (isHiddenByCollapse(element)) continue;
      const bounds = labelBoundsOf(element);
      if (!bounds || !boxContains(bounds, point)) continue;
      found = this.of(element);
    }
    return found;
  }

  /** Forget an owner's label (its element was deleted); takes the OWNER's id. */
  drop(owner: SceneElement | string): void {
    this.cache.delete(labelIdOf(typeof owner === 'string' ? { id: owner } : owner));
  }

  /** Forget every label (a fresh import). */
  clear(): void {
    this.cache.clear();
  }
}
