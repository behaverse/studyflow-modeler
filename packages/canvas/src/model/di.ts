/**
 * {@link Scene} → BPMN DI. Rebuilds `definitions.diagrams` from the scene: one plane
 * holding a `BPMNShape` / `BPMNEdge` per element, a `BPMNLabel` per pinned caption.
 */

import { COLOR_PROPERTIES } from '@canvas/model/color.ts';
import { asList, asModdle, mint, modelOf, prop, setParent, setProp, type ModdleFactory } from '@canvas/model/moddle.ts';
import type { ModdleObject, Scene, SceneEdge, SceneLabel, SceneNode } from '@canvas/model/scene.ts';
import { drawablesOf, isExpandable } from '@canvas/model/tree.ts';

export function writeDi(scene: Scene): void {
  const definitions = scene.definitions;
  const factory = modelOf(definitions);
  let diagram = asList(prop(definitions, 'diagrams'))[0];
  if (!diagram) {
    diagram = mint(factory, 'bpmndi:BPMNDiagram', { id: 'BPMNDiagram_1' });
    setParent(diagram, definitions);
  }
  let plane = asModdle(prop(diagram, 'plane'));
  if (!plane) {
    plane = mint(factory, 'bpmndi:BPMNPlane', { id: 'BPMNPlane_1' });
    setParent(plane, diagram);
    setProp(diagram, 'plane', plane);
  }
  setProp(plane, 'bpmnElement', scene.root);
  const elements: ModdleObject[] = [];
  for (const element of drawablesOf(scene)) {
    const di = element.kind === 'node' ? shapeDi(element, factory) : edgeDi(element, factory);
    setParent(di, plane);
    elements.push(di);
  }
  setProp(plane, 'planeElement', elements);
  setProp(definitions, 'diagrams', [diagram]);
}

function shapeDi(node: SceneNode, factory: ModdleFactory | undefined): ModdleObject {
  const di = mint(factory, 'bpmndi:BPMNShape', {
    id: `${node.id}_di`,
    bpmnElement: node.businessObject,
    bounds: bounds(factory, node),
  });
  setParent(prop(di, 'bounds') as ModdleObject, di);
  if (node.isExpanded !== undefined && (isExpandable(node.type) || node.type === 'bpmn:Participant')) {
    setProp(di, 'isExpanded', node.isExpanded);
  }
  if (node.isMarkerVisible !== undefined) setProp(di, 'isMarkerVisible', node.isMarkerVisible);
  writeColors(di, node.fill, node.stroke);
  writeLabel(di, node.label, factory);
  return di;
}

function edgeDi(edge: SceneEdge, factory: ModdleFactory | undefined): ModdleObject {
  const di = mint(factory, 'bpmndi:BPMNEdge', {
    id: `${edge.id}_di`,
    bpmnElement: edge.businessObject,
    waypoint: edge.waypoints.map((p) => mint(factory, 'dc:Point', { x: p.x, y: p.y })),
  });
  for (const point of asList(prop(di, 'waypoint'))) setParent(point, di);
  writeColors(di, undefined, edge.stroke);
  writeLabel(di, edge.label, factory);
  return di;
}

function bounds(factory: ModdleFactory | undefined, box: { x: number; y: number; width: number; height: number }): ModdleObject {
  return mint(factory, 'dc:Bounds', { x: box.x, y: box.y, width: box.width, height: box.height });
}

function writeColors(di: ModdleObject, fill: string | undefined, stroke: string | undefined): void {
  if (fill) for (const name of COLOR_PROPERTIES.fill) setProp(di, name, fill);
  if (stroke) for (const name of COLOR_PROPERTIES.stroke) setProp(di, name, stroke);
}

function writeLabel(di: ModdleObject, label: SceneLabel | undefined, factory: ModdleFactory | undefined): void {
  if (!label?.pinned) return;
  const labelDi = mint(factory, 'bpmndi:BPMNLabel', { bounds: bounds(factory, label) });
  setParent(prop(labelDi, 'bounds') as ModdleObject, labelDi);
  setParent(labelDi, di);
  setProp(di, 'label', labelDi);
}
