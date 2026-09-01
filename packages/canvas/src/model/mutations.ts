/**
 * `createMutations` — the one part of the editor facade that is not the canvas under
 * another name.
 *
 * Every member here runs inside `step()`: the write, the re-draw, and the commit
 * point. That bracket is the contract "one call = one undo step", and the canvas
 * cannot provide it on its own — it has no command stack, so the app lends it one
 * ({@link MutationHistory}, `@modeler/editor/history.ts`) and everything that hangs
 * off a commit — autosave, provenance, dirty tracking — hangs off `record()`.
 *
 * `CommandStackChanged` is deliberately NOT fired here. It belongs to the history,
 * which hears every mutation source (a drag, an inline rename, a keyboard delete)
 * and not just `mutate.*`; firing it here as well would double-count every write.
 *
 * It lives here, beside `model/writeback.ts`, because that is what it orchestrates
 * and what it is written in: `prop`/`setProp`, {@link Canvas.resolveElement},
 * `Writeback.touch`.
 */

import type { Canvas } from '@canvas/Canvas.ts';
import type { CreatePrototype, ShapeDescriptor } from '@canvas/interaction/create.ts';
import { prop, setProp } from '@canvas/model/moddle.ts';
import type { ModdleObject, Point, SceneElement, SceneNode } from '@canvas/model/scene.ts';
import type { EditorElement, EditorMutations } from '@canvas/editor.ts';

/** The commit point a mutation closes on — the app's snapshot history. */
export interface MutationHistory {
  /** Called immediately AFTER a mutation applied. */
  record(): void;
}

/** Build the undoable-mutation half of the editor facade over `canvas`. */
export function createMutations(canvas: Canvas, history: MutationHistory): EditorMutations {
  const resolve = (value: EditorElement | string): SceneElement | undefined =>
    canvas.resolveElement(value);

  /**
   * Run one logical undo step: the write, the re-draw, and the commit point the
   * history bumps its revision and fires `CommandStackChanged` from. `apply`
   * returns the elements to re-draw.
   */
  const step = <T>(apply: () => T, changed?: (result: T) => SceneElement[]): T => {
    const result = apply();
    const dirty = changed?.(result) ?? [];
    if (dirty.length > 0) canvas.redrawElements(dirty);
    history.record();
    return result;
  };

  /** Write `properties` onto a moddle object; returns whether anything changed. */
  const writeProps = (target: ModdleObject, properties: Record<string, unknown>): boolean => {
    let touched = false;
    for (const [key, value] of Object.entries(properties)) {
      if (prop(target, key) === value) continue;
      setProp(target, key, value);
      touched = true;
    }
    return touched;
  };

  /** Fire the change events for a facade element that is not a scene element. */
  const fireChanged = (element: EditorElement): void => {
    const bus = canvas.getEventBus();
    bus.fire('ElementChanged', { element });
    bus.fire('ElementsChanged', { elements: [element] });
  };

  const mutate: EditorMutations = {
    setColor: (targets, colors) => {
      const list = (Array.isArray(targets) ? targets : [targets])
        .map(resolve)
        .filter((element): element is SceneElement => !!element);
      step(() => canvas.setColor(list, colors));
    },
    updateProperties: (element, properties) => {
      const target = resolve(element);
      const bo: ModdleObject = target?.businessObject ?? element?.businessObject ?? element;
      step(
        () => writeProps(bo, properties),
        (touched) => (touched && target ? [target] : []),
      );
      if (!target) fireChanged(element);
      else canvas.getWriteback()?.touch(target);
    },
    update: (element, target, properties) => {
      const bo = (element?.businessObject ?? element) as ModdleObject;
      if (target === bo) mutate.updateProperties(element, properties);
      else mutate.updateModdleProperties(element, target, properties);
    },
    updateModdleProperties: (element, moddleElement, properties) => {
      const target = resolve(element);
      step(
        () => writeProps(moddleElement as ModdleObject, properties),
        (touched) => (touched && target ? [target] : []),
      );
      if (!target) fireChanged(element);
      else canvas.getWriteback()?.touch(target);
    },
    resizeShape: (shape, bounds) => {
      const target = resolve(shape);
      if (!target || target.kind !== 'node') return;
      step(() => canvas.getWriteback()?.setNodeBounds(target, bounds) ?? [], (changed) => changed);
    },
    // Shape AND flow inside one `step`: an append is one gesture, so it is one undo.
    // A CONNECTION is a legal source here (never for `Canvas.startConnect`): the one
    // append a selected sequence flow offers is "Add text annotation" (ux-spec §4),
    // and the canvas gates the pair through `Rules.canAppendType` either way.
    appendShape: (source, shape) => step(() => {
      const from = resolve(source);
      if (!from) return undefined;
      return canvas.appendElement(from, shape as ShapeDescriptor | CreatePrototype);
    }),
    createShape: (shape, position, _parent, _hints) => step(
      () => canvas.createElement(shape as ShapeDescriptor | CreatePrototype, {
        x: position.x,
        y: position.y,
      } as Point),
    ),
    createConnection: (source, target, _connection, _parent, _hints) => step(() => {
      const from = resolve(source);
      const to = resolve(target);
      if (!from || from.kind !== 'node' || !to || to.kind !== 'node') return undefined;
      return canvas.connectElements(from as SceneNode, to as SceneNode);
    }),
    replaceShape: (element, attrs) => step(() => {
      const target = resolve(element);
      if (!target || target.kind !== 'node') return undefined;
      return canvas.replaceElement(target as SceneNode, attrs as ShapeDescriptor);
    }),
    removeElements: (targets) => {
      const list = (Array.isArray(targets) ? targets : [targets])
        .map(resolve)
        .filter((element): element is SceneElement => !!element);
      if (list.length === 0) return [];
      return step(() => canvas.deleteElements(list));
    },
  };

  return mutate;
}
