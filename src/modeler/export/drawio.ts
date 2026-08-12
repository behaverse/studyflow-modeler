import { exportDiagramName } from '@/modeler/export/common';
import { readChoreographyBands } from '@behaverse/studyflow-core/document';
import { choreographyBandHeight } from '@/modeler/draw/choreographyLayout';
import type { Modeler } from '@/modeler/bpmn/types';

/** draw.io's connection points for a BPMN activity, as its palette emits them. */
const ACTIVITY_POINTS = 'points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],'
  + '[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];';

const ACTIVITY_BASE = `${ACTIVITY_POINTS}shape=mxgraph.bpmn.task2;whiteSpace=wrap;rectStyle=rounded;`
  + 'size=10;html=1;container=0;collapsible=0;';

const EVENT_BASE = 'points=[[0.145,0.145,0],[0.5,0,0],[0.855,0.145,0],[1,0.5,0],[0.855,0.855,0],'
  + '[0.5,1,0],[0.145,0.855,0],[0,0.5,0]];shape=mxgraph.bpmn.event;html=1;verticalLabelPosition=bottom;'
  + 'labelBackgroundColor=none;verticalAlign=top;align=center;perimeter=ellipsePerimeter;'
  + 'outlineConnect=0;aspect=fixed;';

const GATEWAY_BASE = 'points=[[0.25,0.25,0],[0.5,0,0],[0.75,0.25,0],[1,0.5,0],[0.75,0.75,0],[0.5,1,0],'
  + '[0.25,0.75,0],[0,0.5,0]];shape=mxgraph.bpmn.gateway2;html=1;verticalLabelPosition=bottom;'
  + 'labelBackgroundColor=none;verticalAlign=top;align=center;perimeter=rhombusPerimeter;outlineConnect=0;';

const DATA_OBJECT_BASE = 'shape=mxgraph.bpmn.data2;labelPosition=center;verticalLabelPosition=bottom;'
  + 'align=center;verticalAlign=top;size=15;html=1;';

const TASK_MARKERS: Record<string, string> = {
  'bpmn:UserTask': 'user',
  'bpmn:ServiceTask': 'service',
  'bpmn:ScriptTask': 'script',
  'bpmn:ManualTask': 'manual',
  'bpmn:SendTask': 'send',
  'bpmn:ReceiveTask': 'receive',
  'bpmn:BusinessRuleTask': 'businessRule',
};

const EVENT_SYMBOLS: Record<string, string> = {
  'bpmn:MessageEventDefinition': 'message',
  'bpmn:TimerEventDefinition': 'timer',
  'bpmn:ErrorEventDefinition': 'error',
  'bpmn:EscalationEventDefinition': 'escalation',
  'bpmn:CancelEventDefinition': 'cancel',
  'bpmn:CompensateEventDefinition': 'compensation',
  'bpmn:ConditionalEventDefinition': 'conditional',
  'bpmn:LinkEventDefinition': 'link',
  'bpmn:SignalEventDefinition': 'signal',
  'bpmn:TerminateEventDefinition': 'terminate',
};

const GATEWAY_TYPES: Record<string, string> = {
  'bpmn:ExclusiveGateway': 'outline=none;symbol=none;gwType=exclusive;',
  'bpmn:ParallelGateway': 'outline=none;symbol=none;gwType=parallel;',
  'bpmn:ComplexGateway': 'outline=none;symbol=none;gwType=complex;',
  'bpmn:InclusiveGateway': 'outline=standard;symbol=general;',
  'bpmn:EventBasedGateway': 'outline=standard;symbol=multiple;',
};

const CONTAINER_TYPES = new Set(['bpmn:Participant', 'bpmn:Lane']);

/** A choreography task is the one shape draw.io builds from parts: a stack container of band, body, band. */
const CHOREOGRAPHY_FRAME = 'rounded=1;whiteSpace=wrap;html=1;container=1;collapsible=0;'
  + 'absoluteArcSize=1;arcSize=20;childLayout=stackLayout;horizontal=1;horizontalStack=0;'
  + 'resizeParent=1;resizeParentMax=0;resizeLast=0;';
const CHOREOGRAPHY_BODY = 'shape=mxgraph.bpmn.task2;part=1;taskMarker=abstract;connectable=0;'
  + 'whiteSpace=wrap;html=1;';
const CHOREOGRAPHY_BAND = 'whiteSpace=wrap;connectable=0;html=1;shape=mxgraph.basic.rect;size=10;'
  + 'rectStyle=rounded;part=1;';

const RECEIVING_BAND_FILL = '#ededed';

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A cell `value` renders as HTML (`html=1`): escape once for HTML, once more as an XML attribute; newlines become `<br>`. */
function toCellValue(text: string): string {
  return escapeXml(escapeXml(text).replace(/\r?\n/g, '<br>'));
}

/** mxCell ids `0` and `1` are draw.io's own root and default layer. */
function toCellId(id: string): string {
  return id === '0' || id === '1' ? `cell-${id}` : id;
}

function rootOf(element: any): any {
  let current = element;
  while (current.parent) current = current.parent;
  return current;
}

function depthOf(element: any): number {
  let depth = 0;
  for (let current = element.parent; current; current = current.parent) depth++;
  return depth;
}

/** Paint order, since draw.io has no z-index and simply draws cells in document order */
function paintRank(element: any): number {
  if (element.type === 'bpmn:Group') return 1;
  const isSubProcess = element.type === 'bpmn:SubProcess' || element.type === 'bpmn:Transaction'
    || element.type === 'bpmn:AdHocSubProcess';
  const isFrame = CONTAINER_TYPES.has(element.type) || (isSubProcess && !element.collapsed);
  return isFrame ? 0 : 2;
}

function labelOf(bo: any): string {
  if (!bo) return '';
  if (bo.$type === 'bpmn:TextAnnotation') return typeof bo.text === 'string' ? bo.text : '';
  if (bo.$type === 'bpmn:Group') {
    const category = bo.categoryValueRef?.value;
    return typeof category === 'string' ? category : '';
  }
  return typeof bo.name === 'string' ? bo.name : '';
}

function activityMarkers(bo: any): string {
  const loop = bo?.loopCharacteristics;
  let style = '';
  if (loop?.$type === 'bpmn:MultiInstanceLoopCharacteristics') {
    style += loop.isSequential ? 'isLoopMultiSeq=1;' : 'isLoopMultiParallel=1;';
  } else if (loop?.$type === 'bpmn:StandardLoopCharacteristics') {
    style += 'isLoopStandard=1;';
  }
  if (bo?.$type === 'bpmn:AdHocSubProcess') style += 'isAdHoc=1;';
  return style;
}

function eventSymbol(bo: any): string {
  const definitions = bo?.eventDefinitions ?? [];
  if (definitions.length > 1) return bo?.parallelMultiple ? 'parallelMultiple' : 'multiple';
  if (definitions.length === 1) return EVENT_SYMBOLS[definitions[0].$type] ?? 'general';
  return 'general';
}

function eventOutline(element: any, bo: any): string {
  switch (element.type) {
    case 'bpmn:EndEvent': return 'end';
    case 'bpmn:IntermediateThrowEvent': return 'throwing';
    case 'bpmn:IntermediateCatchEvent': return 'catching';
    case 'bpmn:BoundaryEvent': return bo?.cancelActivity === false ? 'boundNonint' : 'boundInt';
    default: return 'standard';
  }
}

function shapeStyle(element: any, bo: any): string {
  const type = element.type as string;

  if (type === 'bpmn:Participant') {
    return 'swimlane;html=1;horizontal=0;startSize=30;fontStyle=1;collapsible=0;'
      + 'swimlaneLine=1;whiteSpace=wrap;';
  }
  if (type === 'bpmn:Lane') {
    return 'swimlane;html=1;horizontal=0;startSize=20;fontStyle=0;collapsible=0;'
      + 'swimlaneLine=1;fillColor=none;whiteSpace=wrap;';
  }
  if (type === 'bpmn:Group') {
    return `${ACTIVITY_POINTS}rounded=1;arcSize=10;dashed=1;fillColor=none;gradientColor=none;`
      + 'dashPattern=8 3 1 3;strokeWidth=2;whiteSpace=wrap;html=1;verticalAlign=top;';
  }
  if (type === 'bpmn:TextAnnotation') {
    return 'shape=mxgraph.flowchart.annotation_1;html=1;align=left;verticalAlign=top;'
      + 'spacingLeft=6;spacingTop=2;whiteSpace=wrap;';
  }
  if (type === 'bpmn:DataStoreReference' || type === 'bpmn:DataStore') {
    return 'shape=datastore;html=1;labelPosition=center;verticalLabelPosition=bottom;'
      + 'align=center;verticalAlign=top;whiteSpace=wrap;';
  }
  if (type === 'bpmn:DataObjectReference' || type === 'bpmn:DataObject'
      || type === 'bpmn:DataInput' || type === 'bpmn:DataOutput') {
    const transfer = type === 'bpmn:DataInput' ? 'input' : type === 'bpmn:DataOutput' ? 'output' : 'none';
    const collection = bo?.isCollection || bo?.dataObjectRef?.isCollection ? 'isCollection=1;' : '';
    return `${DATA_OBJECT_BASE}bpmnTransferType=${transfer};${collection}`;
  }
  if (type.endsWith('Gateway')) {
    return GATEWAY_BASE + (GATEWAY_TYPES[type] ?? 'outline=none;symbol=none;');
  }
  if (type.endsWith('Event')) {
    return `${EVENT_BASE}outline=${eventOutline(element, bo)};symbol=${eventSymbol(bo)};`;
  }
  if (type === 'bpmn:SubProcess' || type === 'bpmn:Transaction' || type === 'bpmn:AdHocSubProcess') {
    // `bpmnShapeType` only for the transaction: draw.io reads its `subprocess` value as an *event* sub-process.
    const transaction = type === 'bpmn:Transaction' ? 'bpmnShapeType=transaction;' : '';
    const collapsed = element.collapsed ? 'isLoopSub=1;' : 'verticalAlign=top;';
    return `${ACTIVITY_BASE}taskMarker=abstract;${transaction}${collapsed}${activityMarkers(bo)}`;
  }
  if (type === 'bpmn:CallActivity') {
    return `${ACTIVITY_BASE}taskMarker=abstract;strokeWidth=3;${activityMarkers(bo)}`;
  }
  return `${ACTIVITY_BASE}taskMarker=${TASK_MARKERS[type] ?? 'abstract'};${activityMarkers(bo)}`;
}

function edgeStyle(element: any, bo: any): string {
  const type = element.type as string;

  if (type === 'bpmn:MessageFlow') {
    return 'html=1;verticalAlign=bottom;dashed=1;dashPattern=8 4;endArrow=blockThin;endFill=1;'
      + 'startArrow=oval;startFill=0;endSize=6;startSize=4;';
  }
  if (type === 'bpmn:Association' || type === 'bpmn:DataInputAssociation'
      || type === 'bpmn:DataOutputAssociation') {
    const directed = type !== 'bpmn:Association' || bo?.associationDirection === 'One'
      || bo?.associationDirection === 'Both';
    return 'html=1;verticalAlign=bottom;endFill=0;startFill=0;endSize=6;startSize=6;dashed=1;'
      + `dashPattern=1 4;endArrow=${directed ? 'openThin' : 'none'};startArrow=`
      + `${bo?.associationDirection === 'Both' ? 'openThin' : 'none'};`;
  }

  const base = 'edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;verticalAlign=bottom;'
    + 'endArrow=blockThin;endFill=1;endSize=6;';
  if (element.source?.businessObject?.default === bo) return `${base}startArrow=dash;startFill=0;startSize=6;`;
  if (bo?.conditionExpression) return `${base}startArrow=diamondThin;startFill=0;startSize=10;`;
  return base;
}

/** bpmn-js keeps element colors on the DI, under either the `bioc` or the `color` namespace. */
function colorStyle(element: any): string {
  const di = element.di;
  if (!di?.get) return '';
  const fill = di.get('color:background-color') || di.get('bioc:fill');
  const stroke = di.get('color:border-color') || di.get('bioc:stroke');
  return (fill ? `fillColor=${fill};` : '') + (stroke ? `strokeColor=${stroke};` : '');
}

function cell(id: string, value: string, style: string, parent: string, geometry: string): string {
  return `        <mxCell id="${escapeXml(id)}" value="${value}" style="${escapeXml(style)}"`
    + ` vertex="1" parent="${escapeXml(parent)}">\n`
    + `          <mxGeometry ${geometry} as="geometry" />\n`
    + '        </mxCell>\n';
}

function choreographyCells(element: any): string {
  const id = toCellId(element.id);
  const { width, height } = element;
  const band = choreographyBandHeight(element);
  const { top, bottom, initiator } = readChoreographyBands(element.businessObject);
  const shade = (edge: 'top' | 'bottom') => (initiator === edge ? '' : `fillColor=${RECEIVING_BAND_FILL};`);

  return cell(id, '', CHOREOGRAPHY_FRAME + colorStyle(element), '1',
    `x="${element.x}" y="${element.y}" width="${width}" height="${height}"`)
    + cell(`${id}-band-top`, toCellValue(top),
      `${CHOREOGRAPHY_BAND}bottomLeftStyle=square;bottomRightStyle=square;${shade('top')}`, id,
      `x="0" y="0" width="${width}" height="${band}"`)
    + cell(`${id}-body`, toCellValue(labelOf(element.businessObject)), CHOREOGRAPHY_BODY, id,
      `x="0" y="${band}" width="${width}" height="${Math.max(0, height - 2 * band)}"`)
    + cell(`${id}-band-bottom`, toCellValue(bottom),
      `${CHOREOGRAPHY_BAND}topLeftStyle=square;topRightStyle=square;${shade('bottom')}`, id,
      `x="0" y="${height - band}" width="${width}" height="${band}"`);
}

function vertexCell(element: any): string {
  if (element.type === 'bpmn:ChoreographyTask') return choreographyCells(element);
  const bo = element.businessObject;
  return cell(toCellId(element.id), toCellValue(labelOf(bo)), shapeStyle(element, bo) + colorStyle(element),
    '1', `x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}"`);
}

function edgeCell(element: any, known: Set<string>): string {
  const bo = element.businessObject;
  const style = edgeStyle(element, bo) + colorStyle(element);
  const waypoints: Array<{ x: number; y: number }> = element.waypoints ?? [];

  // draw.io re-derives attached endpoints from the shape perimeter; only a dangling end is pinned.
  const sourceId = element.source && known.has(element.source.id) ? toCellId(element.source.id) : null;
  const targetId = element.target && known.has(element.target.id) ? toCellId(element.target.id) : null;
  const ends = (sourceId ? ` source="${escapeXml(sourceId)}"` : '')
    + (targetId ? ` target="${escapeXml(targetId)}"` : '');

  let geometry = '';
  if (!sourceId && waypoints.length > 0) {
    geometry += `            <mxPoint x="${waypoints[0].x}" y="${waypoints[0].y}" as="sourcePoint" />\n`;
  }
  if (!targetId && waypoints.length > 0) {
    const last = waypoints[waypoints.length - 1];
    geometry += `            <mxPoint x="${last.x}" y="${last.y}" as="targetPoint" />\n`;
  }
  // The first and last waypoints sit on shape borders; only the bends between are draw.io waypoints.
  const bends = waypoints.slice(1, -1);
  if (bends.length > 0) {
    geometry += '            <Array as="points">\n'
      + bends.map((point) => `              <mxPoint x="${point.x}" y="${point.y}" />\n`).join('')
      + '            </Array>\n';
  }

  return `        <mxCell id="${escapeXml(toCellId(element.id))}" value="${toCellValue(labelOf(bo))}"`
    + ` style="${escapeXml(style)}" edge="1" parent="1"${ends}>\n`
    + `          <mxGeometry relative="1" as="geometry">\n${geometry}          </mxGeometry>\n`
    + '        </mxCell>\n';
}

export function exportToDrawio(modeler: Modeler): string {
  const root = modeler.get('canvas').getRootElement();
  const shapes: any[] = [];
  const connections: any[] = [];

  modeler.get('elementRegistry').forEach((element: any) => {
    if (element === root || element.type === 'label' || !element.businessObject) return;
    if (rootOf(element) !== root) return;
    if (element.waypoints) connections.push(element);
    else if (Number.isFinite(element.x) && Number.isFinite(element.y)) shapes.push(element);
  });

  shapes.sort((a, b) => paintRank(a) - paintRank(b) || depthOf(a) - depthOf(b));

  const known = new Set(shapes.map((shape) => shape.id));
  const cells = shapes.map(vertexCell).join('')
    + connections.map((connection) => edgeCell(connection, known)).join('');

  const name = exportDiagramName(modeler);

  return '<mxfile host="studyflow-modeler">\n'
    + `  <diagram id="${escapeXml(toCellId(root?.id ?? 'studyflow'))}" name="${escapeXml(name)}">\n`
    + '    <mxGraphModel dx="0" dy="0" grid="0" gridSize="10" guides="1" tooltips="1" connect="1"'
    + ' arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">\n'
    + '      <root>\n'
    + '        <mxCell id="0" />\n'
    + '        <mxCell id="1" parent="0" />\n'
    + cells
    + '      </root>\n'
    + '    </mxGraphModel>\n'
    + '  </diagram>\n'
    + '</mxfile>\n';
}
