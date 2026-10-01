/**
 * The scene graph: one tree of nodes, edges and labels in a single coordinate space, drawn from a study model.
 *
 * Geometry, colours and the drawing's flags live here and are written into the study's layout on each commit
 * (`study/di.ts`). The study model's elements stay the source of truth for everything semantic (names,
 * references, containment, attributes).
 */

import type { Bounds, Point } from '@core/document/outline.ts';
import type { Element, StudyModel } from '@core/model/index.ts';

import type { Font } from '@canvas/study/font.ts';

export type { Bounds, Point };

export interface ElementColors {
  fill?: string | null;
  stroke?: string | null;
}

export type { Font, FontPatch, TextAlign } from '@canvas/study/font.ts';

interface Base {
  readonly id: string;
  /** The BPMN element it is (`bpmn:Task`); a schema's type of it is its element's. */
  type: string;
  /** What it draws, as the study model holds it. */
  element: Element;
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
  /** The caption's look, when it departs from the stock one. */
  font?: Font;
}

export interface SceneEdge extends Base {
  readonly kind: 'edge';
  waypoints: Point[];
  source?: SceneNode;
  target?: SceneNode;
  label?: SceneLabel;
  stroke?: string;
  font?: Font;
}

/**
 * A caption drawn beside its owner. `element` and `type` are the owner's,
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

/** What draws an element of its own: nodes and edges, not the labels that caption them. */
export type Drawable = SceneNode | SceneEdge;

/** The document root (process / collaboration) projected onto an element shape. */
export interface RootElement {
  readonly id: string;
  readonly type: string;
  readonly isRoot: true;
  element: Element;
  children: SceneElement[];
  parent: undefined;
}

export interface Scene {
  /** The study the scene draws, which every edit writes. */
  model: StudyModel;
  /** The root the diagram depicts (`bpmn:Process` or `bpmn:Collaboration`). */
  root: Element;
  rootElement: RootElement;
  /** Top-level nodes and edges, in document order. */
  children: SceneElement[];
  elementsById: Map<string, SceneElement>;
  /** Bumped on every committed edit. */
  revision: number;
}

export function isRootElement(value: unknown): value is RootElement {
  return !!value && (value as RootElement).isRoot === true;
}
