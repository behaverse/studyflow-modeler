import { layoutProcess } from 'bpmn-auto-layout';
import { BpmnModdle } from 'bpmn-moddle';

/**
 * Give a diagram enough geometry for the canvas to render it.
 *
 * bpmn-js draws from BPMN Diagram Interchange (the `bpmndi:BPMNDiagram`
 * subtree); a document without it aborts import with "no diagram to display".
 * Hand-written `.studyflow` files describe only the flow graph — nodes, edges,
 * and their studyflow/cognitive extensions — so they carry no layout, and the
 * codec keeps them that way (geometry is a view concern, not part of the
 * lossless YAML <-> XML mapping).
 *
 * `ensureDiagramLayout` bridges that gap at the import boundary: when the XML
 * has no DI, `bpmn-auto-layout` synthesizes a left-to-right layout. Its output
 * is used for **geometry only**: bpmn-auto-layout parses with a plain
 * bpmn-moddle that silently drops extension child elements (`studyflow:with`,
 * a `Parameters` body, …), so the semantic tree is re-read from the *original*
 * XML with the schema-aware moddle and only the DI subtree is copied over.
 * Documents that already ship geometry are returned as-is, so authored
 * layouts are never disturbed.
 *
 * bpmn-auto-layout also covers the control flow only: it creates DI for flow
 * nodes, sequence flows, and boundary events, but leaves data associations
 * without edges and drops data elements into a disconnected column. The
 * data-flow pass closes that gap — it moves each data element next to the
 * steps it is wired to and synthesizes the missing `BPMNEdge` DI for every
 * data input/output association, so the data flow renders and a step's
 * inputs/outputs can be read off the diagram.
 */

/**
 * True when `xml` already carries a `bpmndi:BPMNDiagram`. Prefix-agnostic: the
 * DI namespace is conventionally bound to `bpmndi`, but the check matches the
 * local name under any prefix so a non-standard binding still counts as DI.
 */
export function hasDiagramInterchange(xml: string): boolean {
  return /<(?:[\w.-]+:)?BPMNDiagram[\s/>]/.test(xml);
}

/**
 * Return `xml` with DI, synthesizing a layout when it has none. Pass the
 * schema-aware `moddle` (the modeler's own) so the semantic tree survives
 * with full fidelity; without one, a plain bpmn-moddle is used and extension
 * *child elements* on flow nodes may be dropped.
 */
export async function ensureDiagramLayout(xml: string, moddle?: any): Promise<string> {
  if (hasDiagramInterchange(xml)) return xml;
  try {
    const laidOut = await layoutProcess(xml);
    return await rebuildWithLayout(xml, laidOut, moddle ?? (new BpmnModdle() as any));
  } catch (err) {
    // Auto-layout covers the process/collaboration forms the canvas hosts; if
    // it cannot lay a particular document out, hand the original back so the
    // importer surfaces its own (more specific) error instead of this one.
    console.warn('Auto-layout failed for a diagram without DI; importing as-is.', err);
    return xml;
  }
}

// ---------------------------------------------------------------------------
// Geometry transplant + data-flow pass
// ---------------------------------------------------------------------------

/** Vertical gap between the flow band and the data band beneath it. */
const DATA_BAND_GAP = 50;
/** Minimum horizontal gap kept between two data shapes on the same band. */
const DATA_SHAPE_GAP = 24;

type Bounds = { x: number; y: number; width: number; height: number };

type DataAssociation = {
  /** The semantic `bpmn:DataInputAssociation` / `bpmn:DataOutputAssociation`. */
  semantic: any;
  /** Data element and activity at the two ends, in edge direction. */
  source: any;
  target: any;
  /** The data element end (used for placement). */
  dataElement: any;
  /** The activity end (the step whose input/output this is). */
  activity: any;
};

/**
 * Re-read the original XML with the schema-aware moddle, copy the DI subtree
 * bpmn-auto-layout produced onto it, run the data-flow pass, and serialize.
 * The lossy laid-out XML is only ever read for geometry.
 */
async function rebuildWithLayout(originalXml: string, laidOutXml: string, moddle: any): Promise<string> {
  const { rootElement: definitions } = await moddle.fromXML(originalXml);
  const { rootElement: laidOut } = await (new BpmnModdle() as any).fromXML(laidOutXml);

  const semanticById = indexSemanticElements(definitions);
  definitions.diagrams = (laidOut.diagrams ?? [])
    .map((diagram: any) => copyDiagram(diagram, semanticById, moddle, definitions))
    .filter(Boolean);

  layoutDataFlowTree(definitions, moddle);

  const { xml } = await moddle.toXML(definitions, { format: true });
  return xml;
}

/** Every semantic element in the tree, keyed by id (processes, nested flow
 *  elements, artifacts, participants). */
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

/** Recreate one BPMNDiagram (plane + shapes/edges) on the faithful tree. */
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

/**
 * Place data elements next to the steps they are wired to and add the DI
 * edges for their associations, operating on the already-parsed tree.
 */
function layoutDataFlowTree(definitions: any, moddle: any): void {
  const associations = collectDataAssociations(definitions);
  if (associations.length === 0) return;

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

    // Associations whose two ends both have a shape on this plane.
    const local = associations.filter(
      (assoc) => shapesById.has(assoc.source.id) && shapesById.has(assoc.target.id),
    );
    if (local.length === 0) continue;

    placeDataElements(local, shapesById);

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
    }
  }
}

/**
 * Walk every process and (nested) sub-process and read the data associations
 * off their activities. Edge direction follows BPMN: an input association runs
 * data element -> activity, an output association activity -> data element.
 */
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

/**
 * Move each wired data element into a band beneath the steps that produce or
 * consume it: centered under the mean of its anchors, pushed below the lowest
 * of them, and nudged down when two data shapes would overlap.
 */
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
  // Deterministic order: by mean anchor x, so staggering is stable.
  const entries = [...anchorsByData.values()].sort(
    (a, b) => meanCenterX(a.anchors) - meanCenterX(b.anchors),
  );

  for (const { shape, anchors } of entries) {
    const bounds: Bounds = shape.bounds;
    bounds.x = meanCenterX(anchors) - bounds.width / 2;
    bounds.y = Math.max(...anchors.map((a) => a.y + a.height)) + DATA_BAND_GAP;

    // Drop to the next band while overlapping an already-placed data shape.
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

/** Point where the segment from `from`'s center toward `to`'s center crosses `from`'s border. */
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
