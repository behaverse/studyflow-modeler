/**
 * An element as plain data, what a study's reads return: what it is, where it sits and how it connects, by id.
 * JSON through and through, so a host, a spec and an AI read it alike; the moddle behind it stays in-process
 * (`study.businessObject(id)`).
 */

import { getExtensionType } from '@core/element/index.ts';
import { nameOf } from '@canvas/study/moddle.ts';
import { isRootElement, type Bounds, type Font, type ModdleObject, type Point, type RootElement, type SceneEdge, type SceneElement, type SceneNode } from '@canvas/study/scene.ts';
import { isExpandable } from '@core/document/outline.ts';
import { getProperty } from '@core/element/moddle.ts';
import { planeOf } from '@canvas/study/tree.ts';

export interface ElementRecord {
  readonly id: string;
  /** The document root (a process or a collaboration), a shape, a flow, or a caption. */
  readonly kind: 'root' | 'node' | 'edge' | 'label';
  /** Its BPMN type (`bpmn:Task`); a caption's is what it captions. */
  readonly type: string;
  /** The schema type that extends `type`, when one does. */
  readonly extension?: string;
  readonly name?: string;
  /** The shape it sits in; absent at the top level. */
  readonly parent?: string;
  /** The collapsed container whose drill-down draws it; absent on the root plane. */
  readonly plane?: string;
  /** A shape's or a caption's box. */
  readonly bounds?: Bounds;
  /** A container's: drawn open. */
  readonly expanded?: boolean;
  /** A boundary event's: the activity it sits on. */
  readonly attachedTo?: string;
  /** A shape's flows in and out. */
  readonly incoming?: readonly string[];
  readonly outgoing?: readonly string[];
  /** A shape BPMN gives a default flow (an exclusive gateway, an activity): which of its flows it is, null for none. */
  readonly default?: string | null;
  /** A flow's ends, and the route between them. */
  readonly source?: string;
  readonly target?: string;
  readonly waypoints?: readonly Point[];
  /** A caption's: what it captions. */
  readonly owner?: string;
  /** A caption's: kept where it was put, rather than placed by what it captions. */
  readonly pinned?: boolean;
  /** Its own colours and its caption's look, where the drawing departs from the stock ones: what `style` writes. */
  readonly fill?: string;
  readonly stroke?: string;
  readonly font?: Font;
}

/** `element` as data. */
export function recordOf(element: SceneElement | RootElement): ElementRecord {
  if (isRootElement(element)) return { id: element.id, kind: 'root', type: element.type, ...describe(element.businessObject) };
  const box = (bounds: Bounds): Bounds => ({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
  if (element.kind === 'label') {
    return { id: element.id, kind: 'label', type: element.type, owner: element.owner.id, bounds: box(element), ...(element.pinned ? { pinned: true } : {}) };
  }
  const plane = planeOf(element);
  const placed = {
    id: element.id,
    type: element.type,
    ...describe(element.businessObject),
    ...(element.parent ? { parent: element.parent.id } : {}),
    ...(plane ? { plane: plane.id } : {}),
  };
  if (element.kind === 'edge') {
    return {
      ...placed,
      kind: 'edge',
      ...(element.source ? { source: element.source.id } : {}),
      ...(element.target ? { target: element.target.id } : {}),
      waypoints: element.waypoints.map(({ x, y }) => ({ x, y })),
      ...styleOf(element),
    };
  }
  const host = getProperty(element.businessObject, 'attachedToRef') as ModdleObject | undefined;
  const takesDefault = !!(element.businessObject.$descriptor as { propertiesByName?: Record<string, unknown> } | undefined)?.propertiesByName?.default;
  return {
    ...placed,
    kind: 'node',
    bounds: box(element),
    ...(isExpandable(element.type) ? { expanded: element.isExpanded !== false } : {}),
    ...(host?.id ? { attachedTo: host.id } : {}),
    incoming: element.incoming.map((edge) => edge.id),
    outgoing: element.outgoing.map((edge) => edge.id),
    ...(takesDefault ? { default: (getProperty(element.businessObject, 'default') as ModdleObject | undefined)?.id ?? null } : {}),
    ...styleOf(element),
  };
}

/** What `element`'s drawing sets of its look. */
function styleOf(element: SceneNode | SceneEdge): Pick<ElementRecord, 'fill' | 'stroke' | 'font'> {
  const fill = element.kind === 'node' ? element.fill : undefined;
  return {
    ...(fill ? { fill } : {}),
    ...(element.stroke ? { stroke: element.stroke } : {}),
    ...(element.font ? { font: { ...element.font } } : {}),
  };
}

/** What a business object says of itself: the schema type extending it, and its name. */
function describe(businessObject: ModdleObject): Pick<ElementRecord, 'extension' | 'name'> {
  const extension = getExtensionType(businessObject);
  const name = nameOf(businessObject);
  return { ...(extension ? { extension } : {}), ...(name ? { name } : {}) };
}
