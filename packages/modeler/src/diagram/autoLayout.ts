import { layoutProcess } from 'bpmn-auto-layout';
import { BpmnModdle } from 'bpmn-moddle';

import { layoutDataFlowTree, pickBounds } from '@canvas/model/dataFlowLayout.ts';

export function hasDiagramInterchange(xml: string): boolean {
  return /<(?:[\w.-]+:)?BPMNDiagram[\s/>]/.test(xml);
}

export async function ensureDiagramLayout(xml: string, moddle?: any): Promise<string> {
  if (hasDiagramInterchange(xml)) return drawMissingDataFlow(xml, moddle ?? (new BpmnModdle() as any));
  try {
    const laidOut = await layoutProcess(xml);
    return await rebuildWithLayout(xml, laidOut, moddle ?? (new BpmnModdle() as any));
  } catch (err) {
    console.warn('Auto-layout failed for a diagram without DI; importing as-is.', err);
    return xml;
  }
}

/** Re-parses with the schema-aware moddle: bpmn-auto-layout's own moddle drops extension attributes. */
async function rebuildWithLayout(originalXml: string, laidOutXml: string, moddle: any): Promise<string> {
  const { rootElement: definitions } = await moddle.fromXML(originalXml);
  const { rootElement: laidOut } = await (new BpmnModdle() as any).fromXML(laidOutXml);

  const semanticById = indexSemanticElements(definitions);
  definitions.diagrams = (laidOut.diagrams ?? [])
    .map((diagram: any) => copyDiagram(diagram, semanticById, moddle, definitions))
    .filter(Boolean);

  layoutDataFlowTree(definitions, moddle, { place: true });

  const { xml } = await moddle.toXML(definitions, { format: true });
  return xml;
}

async function drawMissingDataFlow(xml: string, moddle: any): Promise<string> {
  try {
    const { rootElement: definitions } = await moddle.fromXML(xml);
    if (!layoutDataFlowTree(definitions, moddle, { place: false })) return xml;
    const { xml: repaired } = await moddle.toXML(definitions, { format: true });
    return repaired;
  } catch (err) {
    console.warn('Could not draw the data flow of a diagram; importing as-is.', err);
    return xml;
  }
}

function indexSemanticElements(definitions: any): Map<string, any> {
  const byId = new Map<string, any>();
  const visit = (element: any): void => {
    if (!element || typeof element !== 'object') return;
    if (element.id && !byId.has(element.id)) byId.set(element.id, element);
    for (const key of ['flowElements', 'artifacts', 'participants', 'laneSets', 'lanes']) {
      for (const child of element[key] ?? []) visit(child);
    }
  };
  for (const root of definitions.rootElements ?? []) visit(root);
  return byId;
}

function copyDiagram(diagram: any, semanticById: Map<string, any>, moddle: any, definitions: any): any | null {
  const plane = diagram.plane;
  const planeSemantic = plane?.bpmnElement?.id ? semanticById.get(plane.bpmnElement.id) : undefined;
  if (!plane || !planeSemantic) return null;

  const planeElements: any[] = [];
  for (const di of plane.get('planeElement') ?? []) {
    const semantic = di.bpmnElement?.id ? semanticById.get(di.bpmnElement.id) : undefined;
    if (!semantic) continue;

    if (di.$type === 'bpmndi:BPMNShape') {
      const shape = moddle.create('bpmndi:BPMNShape', {
        id: di.id,
        bpmnElement: semantic,
        bounds: moddle.create('dc:Bounds', pickBounds(di.bounds)),
      });
      if (di.isExpanded !== undefined) shape.isExpanded = di.isExpanded;
      if (di.isMarkerVisible !== undefined) shape.isMarkerVisible = di.isMarkerVisible;
      planeElements.push(shape);
    } else if (di.$type === 'bpmndi:BPMNEdge') {
      planeElements.push(moddle.create('bpmndi:BPMNEdge', {
        id: di.id,
        bpmnElement: semantic,
        waypoint: (di.waypoint ?? []).map((p: any) => moddle.create('dc:Point', { x: p.x, y: p.y })),
      }));
    }
  }

  const newPlane = moddle.create('bpmndi:BPMNPlane', {
    id: plane.id,
    bpmnElement: planeSemantic,
    planeElement: planeElements,
  });
  const newDiagram = moddle.create('bpmndi:BPMNDiagram', { id: diagram.id, plane: newPlane });
  newPlane.$parent = newDiagram;
  newDiagram.$parent = definitions;
  return newDiagram;
}
