/**
 * BpmnDocument: standalone bpmn-moddle bridge for v2 React Flow editor.
 *
 * Wraps bpmn-moddle to provide XML parsing, serialization, element creation,
 * and schema introspection without any bpmn-js dependency.
 */
import { BpmnModdle } from 'bpmn-moddle';

let idCounter = 0;

function generateId(prefix: string): string {
  idCounter += 1;
  const suffix = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${suffix}${idCounter}`;
}

export class BpmnDocument {
  private moddle: any;
  private definitions: any = null;

  constructor(extensionSchemas: Record<string, any> = {}) {
    this.moddle = new BpmnModdle(extensionSchemas);
  }

  /** Parse BPMN XML into a moddle definitions object. */
  async fromXML(xml: string): Promise<{ definitions: any; warnings: string[] }> {
    const result = await this.moddle.fromXML(xml);
    this.definitions = result.rootElement;
    return { definitions: this.definitions, warnings: result.warnings ?? [] };
  }

  /** Serialize current definitions to BPMN XML. */
  async toXML(options?: { format?: boolean }): Promise<string> {
    if (!this.definitions) {
      throw new Error('No definitions loaded. Call fromXML() first.');
    }
    const result = await this.moddle.toXML(this.definitions, {
      format: options?.format ?? true,
    });
    return result.xml;
  }

  /** Create a moddle element of the given type with the given attributes. */
  createElement(type: string, attrs: Record<string, any> = {}): any {
    return this.moddle.create(type, attrs);
  }

  /** Generate a prefixed ID (e.g., "Task_abc123"). */
  nextId(prefix: string): string {
    return generateId(prefix);
  }

  /** Get the current definitions root element. */
  getDefinitions(): any {
    return this.definitions;
  }

  /** Get the underlying bpmn-moddle instance. */
  getModdle(): any {
    return this.moddle;
  }

  /** Get the moddle type registry for schema introspection. */
  getTypeMap(): Record<string, any> {
    return this.moddle.registry?.typeMap ?? {};
  }

  /** Get all package enumerations across loaded schemas. */
  getEnumerations(): any[] {
    return Object.values(this.moddle.registry?.packageMap ?? {})
      .flatMap((pkg: any) => pkg?.enumerations ?? []);
  }

  /** Get a type descriptor by qualified name. */
  getTypeDescriptor(typeName: string): any {
    return this.moddle.getTypeDescriptor(typeName);
  }

  /** Get the first process element from definitions. */
  getProcess(): any {
    return this.definitions?.rootElements?.find(
      (el: any) => el.$type === 'bpmn:Process'
    ) ?? null;
  }

  /** Get the first diagram from definitions. */
  getDiagram(): any {
    return this.definitions?.diagrams?.[0] ?? null;
  }

  /** Get the BPMNPlane from the first diagram. */
  getPlane(): any {
    return this.getDiagram()?.plane ?? null;
  }

  /** Get all plane elements (shapes and edges). */
  getPlaneElements(): any[] {
    return this.getPlane()?.planeElement ?? [];
  }

  /** Find the DI shape for a given BPMN element ID. */
  findShape(elementId: string): any {
    return this.getPlaneElements().find(
      (pe: any) => pe.$type === 'bpmndi:BPMNShape' && pe.bpmnElement?.id === elementId
    ) ?? null;
  }

  /** Find the DI edge for a given BPMN element ID. */
  findEdge(elementId: string): any {
    return this.getPlaneElements().find(
      (pe: any) => pe.$type === 'bpmndi:BPMNEdge' && pe.bpmnElement?.id === elementId
    ) ?? null;
  }

  /** Add a flow element to the process and create its DI shape. */
  addFlowElement(
    businessObject: any,
    bounds: { x: number; y: number; width: number; height: number },
  ): void {
    const process = this.getProcess();
    if (!process) throw new Error('No process found in definitions.');

    // Add to process flowElements
    if (!process.flowElements) {
      process.flowElements = [];
    }
    businessObject.$parent = process;
    process.flowElements.push(businessObject);

    // Create DI shape
    const shape = this.createElement('bpmndi:BPMNShape', {
      bpmnElement: businessObject,
    });
    shape.bounds = this.createElement('dc:Bounds', bounds);
    shape.$parent = this.getPlane();
    this.getPlane().planeElement.push(shape);
  }

  /** Add a sequence flow between two elements. */
  addSequenceFlow(
    sourceRef: any,
    targetRef: any,
    attrs: Record<string, any> = {},
    waypoints?: Array<{ x: number; y: number }>,
  ): any {
    const process = this.getProcess();
    if (!process) throw new Error('No process found in definitions.');

    const id = this.nextId('Flow');
    const flow = this.createElement('bpmn:SequenceFlow', {
      id,
      sourceRef,
      targetRef,
      ...attrs,
    });
    flow.$parent = process;
    if (!process.flowElements) process.flowElements = [];
    process.flowElements.push(flow);

    // Update source/target outgoing/incoming
    if (!sourceRef.outgoing) sourceRef.outgoing = [];
    sourceRef.outgoing.push(flow);
    if (!targetRef.incoming) targetRef.incoming = [];
    targetRef.incoming.push(flow);

    // Create DI edge
    const edge = this.createElement('bpmndi:BPMNEdge', {
      bpmnElement: flow,
    });
    if (waypoints && waypoints.length > 0) {
      edge.waypoint = waypoints.map((wp) =>
        this.createElement('dc:Point', wp)
      );
    }
    edge.$parent = this.getPlane();
    this.getPlane().planeElement.push(edge);

    return flow;
  }

  /** Remove a flow element and its DI representation. */
  removeFlowElement(elementId: string): void {
    const process = this.getProcess();
    if (!process?.flowElements) return;

    const idx = process.flowElements.findIndex((el: any) => el.id === elementId);
    if (idx !== -1) {
      const element = process.flowElements[idx];

      // Remove incoming/outgoing references
      if (element.sourceRef?.outgoing) {
        element.sourceRef.outgoing = element.sourceRef.outgoing.filter(
          (f: any) => f.id !== elementId
        );
      }
      if (element.targetRef?.incoming) {
        element.targetRef.incoming = element.targetRef.incoming.filter(
          (f: any) => f.id !== elementId
        );
      }

      // Remove connected sequence flows if this is a shape
      if (element.$type !== 'bpmn:SequenceFlow') {
        const connectedFlows = process.flowElements.filter(
          (el: any) =>
            el.$type === 'bpmn:SequenceFlow' &&
            (el.sourceRef?.id === elementId || el.targetRef?.id === elementId)
        );
        for (const flow of connectedFlows) {
          this.removeFlowElement(flow.id);
        }
      }

      process.flowElements.splice(idx, 1);
    }

    // Remove DI
    const plane = this.getPlane();
    if (plane?.planeElement) {
      plane.planeElement = plane.planeElement.filter(
        (pe: any) => pe.bpmnElement?.id !== elementId
      );
    }
  }
}
