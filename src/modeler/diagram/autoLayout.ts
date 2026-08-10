import { layoutProcess } from 'bpmn-auto-layout';
import { BpmnModdle } from 'bpmn-moddle';

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

const DATA_BAND_GAP = 50;
const DATA_SHAPE_GAP = 24;

type Bounds = { x: number; y: number; width: number; height: number };

/** `source`/`target` are in edge direction; `dataElement`/`activity` are the same two ends by role. */
type DataAssociation = {
  semantic: any;
  source: any;
  target: any;
  dataElement: any;
  activity: any;
};

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

function pickBounds(bounds: any): Bounds {
  return { x: bounds?.x ?? 0, y: bounds?.y ?? 0, width: bounds?.width ?? 0, height: bounds?.height ?? 0 };
}

function layoutDataFlowTree(definitions: any, moddle: any, { place }: { place: boolean }): boolean {
  const associations = collectDataAssociations(definitions);
  if (associations.length === 0) return false;
  let added = false;

  for (const diagram of definitions.diagrams ?? []) {
    const plane = diagram.plane;
    if (!plane) continue;

    const planeElements: any[] = plane.get('planeElement') ?? [];
    const shapesById = new Map<string, any>();
    const edgeIds = new Set<string>();
    for (const di of planeElements) {
      const semanticId = di.bpmnElement?.id;
      if (!semanticId) continue;
      if (di.$type === 'bpmndi:BPMNShape') shapesById.set(semanticId, di);
      if (di.$type === 'bpmndi:BPMNEdge') edgeIds.add(semanticId);
    }

    const local = associations.filter(
      (assoc) => shapesById.has(assoc.source.id) && shapesById.has(assoc.target.id),
    );
    if (local.length === 0) continue;

    if (place) placeDataElements(local, shapesById);

    for (const assoc of local) {
      if (!assoc.semantic.id || edgeIds.has(assoc.semantic.id)) continue;
      const sourceBounds = shapesById.get(assoc.source.id).bounds;
      const targetBounds = shapesById.get(assoc.target.id).bounds;
      const waypoints = [
        borderPoint(sourceBounds, targetBounds),
        borderPoint(targetBounds, sourceBounds),
      ];
      const edge = moddle.create('bpmndi:BPMNEdge', {
        id: `${assoc.semantic.id}_di`,
        bpmnElement: assoc.semantic,
        waypoint: waypoints.map((p) => moddle.create('dc:Point', p)),
      });
      edge.$parent = plane;
      planeElements.push(edge);
      added = true;
    }
  }
  return added;
}

function collectDataAssociations(definitions: any): DataAssociation[] {
  const found: DataAssociation[] = [];

  const visitContainer = (container: any): void => {
    for (const element of container?.flowElements ?? []) {
      for (const assoc of element.dataInputAssociations ?? []) {
        const dataElement = assoc.sourceRef?.[0];
        if (dataElement?.id) {
          found.push({ semantic: assoc, source: dataElement, target: element, dataElement, activity: element });
        }
      }
      for (const assoc of element.dataOutputAssociations ?? []) {
        const dataElement = assoc.targetRef;
        if (dataElement?.id) {
          found.push({ semantic: assoc, source: element, target: dataElement, dataElement, activity: element });
        }
      }
      if (element.flowElements) visitContainer(element);
    }
  };

  for (const root of definitions.rootElements ?? []) {
    if (root.flowElements) visitContainer(root);
  }
  return found;
}

function placeDataElements(associations: DataAssociation[], shapesById: Map<string, any>): void {
  const anchorsByData = new Map<string, { shape: any; anchors: Bounds[] }>();
  for (const assoc of associations) {
    const dataShape = shapesById.get(assoc.dataElement.id);
    const anchorShape = shapesById.get(assoc.activity.id);
    if (!dataShape || !anchorShape) continue;
    const entry = anchorsByData.get(assoc.dataElement.id) ?? { shape: dataShape, anchors: [] };
    entry.anchors.push(anchorShape.bounds);
    anchorsByData.set(assoc.dataElement.id, entry);
  }

  const placed: Bounds[] = [];
  // Sorted so the stagger below is deterministic across runs.
  const entries = [...anchorsByData.values()].sort(
    (a, b) => meanCenterX(a.anchors) - meanCenterX(b.anchors),
  );

  for (const { shape, anchors } of entries) {
    const bounds: Bounds = shape.bounds;
    bounds.x = meanCenterX(anchors) - bounds.width / 2;
    bounds.y = Math.max(...anchors.map((a) => a.y + a.height)) + DATA_BAND_GAP;

    while (placed.some((other) => overlaps(bounds, other))) {
      bounds.y += bounds.height + DATA_BAND_GAP;
    }
    placed.push({ ...bounds });
  }
}

function meanCenterX(anchors: Bounds[]): number {
  return anchors.reduce((sum, a) => sum + a.x + a.width / 2, 0) / anchors.length;
}

function overlaps(a: Bounds, b: Bounds): boolean {
  return (
    a.x < b.x + b.width + DATA_SHAPE_GAP
    && b.x < a.x + a.width + DATA_SHAPE_GAP
    && a.y < b.y + b.height + DATA_SHAPE_GAP
    && b.y < a.y + a.height + DATA_SHAPE_GAP
  );
}

function borderPoint(from: Bounds, to: Bounds): { x: number; y: number } {
  const cx = from.x + from.width / 2;
  const cy = from.y + from.height / 2;
  const dx = to.x + to.width / 2 - cx;
  const dy = to.y + to.height / 2 - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };

  let t = Infinity;
  if (dx !== 0) t = Math.min(t, (dx > 0 ? from.width : -from.width) / 2 / dx);
  if (dy !== 0) t = Math.min(t, (dy > 0 ? from.height : -from.height) / 2 / dy);
  return { x: round(cx + dx * t), y: round(cy + dy * t) };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
