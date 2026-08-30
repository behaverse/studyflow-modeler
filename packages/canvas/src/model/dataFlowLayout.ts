/**
 * Data-flow layout: places data objects/stores below the activities they feed and
 * draws the missing `bpmndi:BPMNEdge`s for their associations. Pure moddle-object
 * geometry — no XML strings, no layout engine.
 */

const DATA_BAND_GAP = 50;
const DATA_SHAPE_GAP = 24;

export type Bounds = { x: number; y: number; width: number; height: number };

/** `source`/`target` are in edge direction; `dataElement`/`activity` are the same two ends by role. */
export type DataAssociation = {
  semantic: any;
  source: any;
  target: any;
  dataElement: any;
  activity: any;
};

export function pickBounds(bounds: any): Bounds {
  return { x: bounds?.x ?? 0, y: bounds?.y ?? 0, width: bounds?.width ?? 0, height: bounds?.height ?? 0 };
}

export function layoutDataFlowTree(definitions: any, moddle: any, { place }: { place: boolean }): boolean {
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
