import { EXAMPLE_FLOW_ELEMENTS } from '../moddle/examples/Examples';
import type {
  ExampleFlowConnection,
  ExampleFlowElement,
  ExampleFlowNode,
} from '../moddle/examples/types';

export type MaterializeExampleFlowCommand = {
  type: 'materialize-example-flow';
  modeling: any;
  examplesService: {
    createFlowNodeShape: (definition: ExampleFlowNode, parent: any) => any;
    createFlowConnection: (
      definition: ExampleFlowConnection,
      source: any,
      target: any,
      parent: any,
    ) => any;
  };
  shape: any;
  newRootElement?: any;
  hintKey: string;
};

export function runMaterializeExampleFlow(
  command: MaterializeExampleFlowCommand,
): void {
  const {
    modeling,
    examplesService,
    shape,
    newRootElement,
    hintKey,
  } = command;

  if (!shape) {
    return;
  }

  const flowElements = shape[EXAMPLE_FLOW_ELEMENTS] as ExampleFlowElement[] | undefined;
  if (!Array.isArray(flowElements) || flowElements.length === 0) {
    return;
  }

  const flowContainer = newRootElement ?? shape;
  const nodeEntries = flowElements.filter(isFlowNode);
  const connectionEntries = flowElements.filter(isFlowConnection);
  const nodesById = new Map<string, any>();

  for (const nodeEntry of nodeEntries) {
    const nodeShape = examplesService.createFlowNodeShape(nodeEntry, flowContainer);
    const createdNode = modeling.createShape(
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
        [hintKey]: true,
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

    const connection = examplesService.createFlowConnection(
      connectionEntry,
      source,
      target,
      flowContainer,
    );

    modeling.createConnection(
      source,
      target,
      connection,
      flowContainer,
      {
        [hintKey]: true,
      },
    );
  }

  delete shape[EXAMPLE_FLOW_ELEMENTS];
}

function isFlowNode(entry: ExampleFlowElement): entry is ExampleFlowNode {
  return entry.kind === 'node';
}

function isFlowConnection(entry: ExampleFlowElement): entry is ExampleFlowConnection {
  return entry.kind === 'connection';
}