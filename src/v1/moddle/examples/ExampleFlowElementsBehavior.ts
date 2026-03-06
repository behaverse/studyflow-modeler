import CommandInterceptor from 'diagram-js/lib/command/CommandInterceptor';
import { EXAMPLE_FLOW_ELEMENTS } from './Examples';
import type Examples from './Examples';
import type { ExampleFlowConnection, ExampleFlowElement, ExampleFlowNode } from './types';

const EXAMPLE_FLOW_HINT = '__studyflowCreatingExampleFlow';

function isFlowNode(entry: ExampleFlowElement): entry is ExampleFlowNode {
  return entry.kind === 'node';
}

function isFlowConnection(entry: ExampleFlowElement): entry is ExampleFlowConnection {
  return entry.kind === 'connection';
}

export default class ExampleFlowElementsBehavior extends CommandInterceptor {

  static $inject = ['eventBus', 'modeling', 'elementTemplates'];

  private _modeling: any;
  private _examples: Examples;

  constructor(eventBus: any, modeling: any, elementTemplates: Examples) {
    super(eventBus);

    this._modeling = modeling;
    this._examples = elementTemplates;

    this.postExecuted('shape.create', (context: any) => {
      this._createNestedFlowElements(context);
    }, true);
  }

  private _createNestedFlowElements(context: any): void {
    const { shape, hints } = context;

    if (!shape || hints?.[EXAMPLE_FLOW_HINT]) {
      return;
    }

    const flowElements = shape[EXAMPLE_FLOW_ELEMENTS] as ExampleFlowElement[] | undefined;
    if (!Array.isArray(flowElements) || flowElements.length === 0) {
      return;
    }

    const flowContainer = context.newRootElement ?? shape;

    const nodeEntries = flowElements.filter(isFlowNode);
    const connectionEntries = flowElements.filter(isFlowConnection);
    const nodesById = new Map<string, any>();

    for (const nodeEntry of nodeEntries) {
      const nodeShape = this._examples.createFlowNodeShape(nodeEntry, flowContainer);
      const createdNode = this._modeling.createShape(
        nodeShape,
        {
          x: nodeShape.x,
          y: nodeShape.y,
          width: nodeShape.width,
          height: nodeShape.height,
        },
        flowContainer,
        {
          autoResize: false,
          [EXAMPLE_FLOW_HINT]: true,
        },
      );

      nodesById.set(nodeEntry.id, createdNode);
    }

    for (const connectionEntry of connectionEntries) {
      const source = nodesById.get(connectionEntry.sourceRef);
      const target = nodesById.get(connectionEntry.targetRef);

      if (!source || !target) {
        console.warn(
          `[examples] Skipping connection '${connectionEntry.id ?? connectionEntry.bpmnType}' because source or target was not found.`
        );
        continue;
      }

      const connection = this._examples.createFlowConnection(connectionEntry, source, target, flowContainer);

      this._modeling.createConnection(
        source,
        target,
        connection,
        flowContainer,
        {
          [EXAMPLE_FLOW_HINT]: true,
        },
      );
    }

    delete shape[EXAMPLE_FLOW_ELEMENTS];
  }
}