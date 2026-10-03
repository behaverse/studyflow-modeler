/**
 * {@link Scene} → the study's drawing. Rewrites the layout map from the scene: an entry per shape and per edge, its
 * box or route, colours, caption style, the box of a pinned caption, and what a shape shows (expanded, a marker). What
 * a draft placed and no edit has touched keeps only its look.
 */

import { formatFont } from '@canvas/study/font.ts';
import type { Scene, SceneEdge, SceneNode } from '@canvas/study/scene.ts';
import { isExpandable } from '@core/document/outline.ts';
import type { Drawing, Value } from '@core/model/index.ts';
import { boxToText, pointsToText } from '@core/model/spelling.ts';
import { canonicalDrawing, inferredRoot } from '@core/model/yaml.ts';
import { drawablesOf } from '@canvas/study/tree.ts';

export function writeLayout(scene: Scene, drafted: ReadonlySet<string> = new Set()): void {
  const { model } = scene;
  const layout: Record<string, Drawing> = {};
  for (const element of drawablesOf(scene)) {
    const drawing = drafted.has(element.id) ? lookOf(drawingOf(scene, element)) : drawingOf(scene, element);
    if (drawing) layout[element.id] = drawing;
  }
  model.study.layout = layout;
  nameRoot(scene);
}

/** What `drawing` says of an element's look (its colours and its caption's), when it says any of it. */
export function lookOf(drawing: Drawing | undefined): Drawing | undefined {
  const look = Object.entries(drawing ?? {}).filter(([key]) => key === 'fill' || key === 'stroke' || key === 'font');
  return look.length > 0 ? Object.fromEntries(look) : undefined;
}

/** The diagram names the root it draws, unless the reader infers that root anyway. */
function nameRoot(scene: Scene): void {
  const { study, metamodel } = scene.model;
  const named = scene.root.id;
  const [first, ...rest] = study.diagram ?? [];
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    const diagram = first as Record<string, Value>;
    diagram.plane = { ...(diagram.plane as Record<string, Value> | undefined), ...(named ? { bpmnElement: named } : {}) };
    study.diagram = [diagram, ...rest];
  } else if (named && named !== inferredRoot(study, metamodel)?.id) {
    study.diagram = [{ plane: { bpmnElement: named } }, ...rest];
  }
}

/** How the study draws `element`: its shape or its edge, in the file's spelling. */
export function drawingOf(scene: Scene, element: SceneNode | SceneEdge): Drawing {
  const drawing: Record<string, Value> = {};
  if (element.kind === 'node') {
    drawing.bounds = boxToText(element);
    if (element.isExpanded !== undefined && (isExpandable(element.type) || element.type === 'bpmn:Participant')) drawing.isExpanded = element.isExpanded;
    if (element.isMarkerVisible !== undefined) drawing.isMarkerVisible = element.isMarkerVisible;
    if (element.fill) drawing.fill = element.fill;
  } else {
    drawing.waypoint = pointsToText(element.waypoints);
  }
  if (element.stroke) drawing.stroke = element.stroke;
  const font = formatFont(element.font);
  if (font) drawing.font = font;
  if (element.label?.pinned) drawing.label = boxToText(element.label);
  return canonicalDrawing(scene.model.metamodel, element.kind === 'node' ? 'bpmndi:BPMNShape' : 'bpmndi:BPMNEdge', drawing);
}
