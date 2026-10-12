/**
 * The links a view draws that the file does not hold, worked out from what the view shows. A data association between
 * data the view draws and a step it does not, because a sub-process drawn closed holds the step, is drawn to that
 * sub-process: once per data element, sub-process and direction, however many steps inside it the link stands for,
 * and not at all when an association of the sub-process's own already joins the two. And an element whose `schema`
 * names a schema the view draws is joined to it, as a note is joined to what it annotates.
 *
 * Neither is an element. Neither has an id, a record or a drawing in the file, and nothing hits, selects, moves or
 * removes one. Each runs straight between its ends, as the router draws an association the file gives no route
 * (`routeFor`), and follows what the view shows: once the sub-process is open, its steps' own associations are drawn.
 */

import { BPMN } from '@core/constants.ts';
import { isDataShape } from '@core/document/outline.ts';
import { DATA_INPUT_ASSOCIATION, isDataAssociationType } from '@core/element/index.ts';

import { idsIn } from '@canvas/study/elements.ts';
import { straightRoute } from '@canvas/study/orthogonal.ts';
import type { Point, Scene, SceneEdge, SceneElement, SceneNode } from '@canvas/study/scene.ts';
import { isHidden, visibleEndpointOf } from '@canvas/study/tree.ts';

/** What a `schema` attribute names, to be drawn joined to the element holding it. */
const SCHEMA = 'studyflow:Schema';

export interface ImpliedLink {
  /** The flow it is drawn as: the data association it stands for, or an association, which points nowhere. */
  readonly type: string;
  readonly source: SceneNode;
  readonly target: SceneNode;
  readonly waypoints: Point[];
  /** The colour of the association it stands for. */
  readonly stroke?: string;
}

/** The links a view drilled into `scope` (none: the whole diagram) draws that the file does not hold. */
export function impliedLinks(scene: Scene, scope?: SceneNode): ImpliedLink[] {
  const shown = (element: SceneElement): boolean => !isHidden(element, scope);
  const links = new Map<string, ImpliedLink>();
  const link = (type: string, source: SceneNode, target: SceneNode, stroke?: string): void => {
    const key = `${type} ${source.id} ${target.id}`;
    if (!links.has(key)) links.set(key, { type, source, target, waypoints: straightRoute(source, target), ...(stroke ? { stroke } : {}) });
  };
  for (const element of scene.elementsById.values()) {
    if (element.kind === 'edge' && isDataAssociationType(element.type)) {
      const ends = standIn(element, scope, shown);
      if (!ends) continue;
      const input = element.type === DATA_INPUT_ASSOCIATION;
      link(element.type, input ? ends.data : ends.container, input ? ends.container : ends.data, element.stroke);
    } else if (element.kind === 'node' && shown(element)) {
      const schema = schemaOf(scene, element);
      if (schema && shown(schema)) link(BPMN.Association, element, schema);
    }
  }
  return [...links.values()];
}

/**
 * For a data association between data the view draws and a step it does not: the data, and the closed sub-process
 * the view draws for the step; nothing when it draws no such sub-process, or when that sub-process holds an
 * association of the same kind with that data itself.
 */
function standIn(
  association: SceneEdge, scope: SceneNode | undefined, shown: (element: SceneElement) => boolean,
): { data: SceneNode; container: SceneNode } | undefined {
  const input = association.type === DATA_INPUT_ASSOCIATION;
  const [data, step] = input ? [association.source, association.target] : [association.target, association.source];
  if (!data || !step || !isDataShape(data.type) || !shown(data) || shown(step)) return undefined;
  const container = visibleEndpointOf(step, scope);
  if (container === step || !shown(container)) return undefined;
  const own = (input ? data.outgoing : data.incoming)
    .some((edge) => edge.type === association.type && (input ? edge.target : edge.source) === container);
  return own ? undefined : { data, container };
}

/** The schema the `schema` of `node` names, as the scene draws it. */
function schemaOf(scene: Scene, node: SceneNode): SceneNode | undefined {
  const { model } = scene;
  const schema = scene.elementsById.get(idsIn(model.attribute(node.element, 'schema'))[0] ?? '');
  if (schema?.kind !== 'node' || schema === node) return undefined;
  const type = model.extensionType(schema.element);
  return type && model.metamodel.isA(type, SCHEMA) ? schema : undefined;
}
