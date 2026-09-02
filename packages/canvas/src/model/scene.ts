/**
 * The scene graph: one tree of nodes, edges and labels in a single coordinate space.
 *
 * Geometry, colours and the DI flags live here and are written out to BPMN DI on
 * save (`model/di.ts`). The business objects stay the source of truth for
 * everything semantic (names, references, containment, attributes).
 */

export type ModdleObject = {
  readonly $type: string;
  id?: string;
  [key: string]: unknown;
};

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElementColors {
  fill?: string | null;
  stroke?: string | null;
}

interface Base {
  readonly id: string;
  type: string;
  businessObject: ModdleObject;
  /** Containing node, or `undefined` at the top level. */
  parent?: SceneNode;
}

export interface SceneNode extends Base {
  readonly kind: 'node';
  x: number;
  y: number;
  width: number;
  height: number;
  /** Nodes and edges filed under this container. */
  children: SceneElement[];
  incoming: SceneEdge[];
  outgoing: SceneEdge[];
  /** External caption (events, gateways, data shapes). */
  label?: SceneLabel;
  isExpanded?: boolean;
  isMarkerVisible?: boolean;
  fill?: string;
  stroke?: string;
}

export interface SceneEdge extends Base {
  readonly kind: 'edge';
  waypoints: Point[];
  source?: SceneNode;
  target?: SceneNode;
  label?: SceneLabel;
  stroke?: string;
}

/**
 * A caption drawn beside its owner. `businessObject` and `type` are the owner's,
 * so selecting a label inspects the element it names. Unpinned labels are re-derived
 * from the owner on every redraw; a pinned one keeps the box the user (or the
 * document) gave it.
 */
export interface SceneLabel extends Base {
  readonly kind: 'label';
  x: number;
  y: number;
  width: number;
  height: number;
  owner: SceneNode | SceneEdge;
  pinned: boolean;
}

export type SceneElement = SceneNode | SceneEdge | SceneLabel;

/** The document root (process / collaboration) projected onto an element shape. */
export interface RootElement {
  readonly id: string;
  readonly type: string;
  readonly isRoot: true;
  businessObject: ModdleObject;
  children: SceneElement[];
  parent: undefined;
}

export interface Scene {
  definitions: ModdleObject;
  /** The business object the diagram depicts (`bpmn:Process` or `bpmn:Collaboration`). */
  root: ModdleObject;
  rootElement: RootElement;
  /** Top-level nodes and edges, in document order. */
  children: SceneElement[];
  elementsById: Map<string, SceneElement>;
  byBusinessObject: Map<ModdleObject, SceneNode | SceneEdge>;
  /** Bumped on every committed edit. */
  revision: number;
  /** View state: the container the editor is drilled into, if any. */
  scope?: SceneNode;
}

export function isRootElement(value: unknown): value is RootElement {
  return !!value && (value as RootElement).isRoot === true;
}
