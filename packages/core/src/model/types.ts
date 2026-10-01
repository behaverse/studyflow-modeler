/**
 * A study as plain data: the model every part of Studyflow reads and writes. It is the `.studyflow.yaml` file's own
 * structure with nothing left implicit, so the file is its direct spelling (`./yaml.ts`) and the BPMN XML a projection
 * of it (`@core/document`, through moddle):
 *
 * - an element is an object with its full `type` (`bpmn:Task`, `cognitive:Questionnaire`) and every property it holds
 *   by its local name; an element a schema types is that schema's type, its attributes beside the element's own, with
 *   no wrapper (the BPMN element it attaches to is its type's `meta.attachesTo`);
 * - what an element contains is a list of elements in file order (`flowElements`, `dataInputAssociations`), never a
 *   map; a flow names its ends (`sourceRef`, `targetRef`) by id, and so does every other reference;
 * - an expression is its text, documentation its text, a YAML-typed attribute its mapping, where the file writes them
 *   so;
 * - the drawing is the `layout` map, each element's by its id, as the file writes it; the run state is `state`.
 *
 * What a property of a type holds, and in which order the file writes them, is the metamodel's (`./metamodel.ts`).
 */

/** Anything an element's property holds: text, a number, a truth value, an element, a list, or a mapping (YAML). */
export type Value = string | number | boolean | null | Element | Value[] | { [key: string]: Value };

/** An element of a study. */
export type Element = {
  /** Its type, by its full name. */
  type: string;
  id?: string;
  [property: string]: Value | undefined;
};

/** How the file draws an element: `bounds: x y w h`, `waypoint: x,y x,y`, `label`, `fill`, `stroke`, `font`, ... */
export type Drawing = Record<string, Value>;

/** The run state a study carries (`state:`), keyed by element id. */
export type State = Record<string, unknown>;

export type Study = {
  /** The definitions' id. */
  id?: string;
  /** What the definitions themselves hold: `targetNamespace`, `exporter`, namespace declarations. */
  definitions: Record<string, Value>;
  /** The root elements: processes, collaborations, messages, item definitions, ... in file order. */
  roots: Element[];
  /** Each element's drawing, by its id, in the order the file writes them. */
  layout: Record<string, Drawing>;
  /** Diagram interchange the layout cannot hold (a second diagram, a plane element the layout cannot spell). */
  diagram?: Value[];
  state?: State;
};

export function isElement(value: unknown): value is Element {
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { type?: unknown }).type === 'string';
}
