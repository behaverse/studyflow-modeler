import { TEMPLATE_FLOW_ELEMENTS } from '../../moddle/templates/Templates';
import type {
  TemplateFlowConnection,
  TemplateFlowElement,
  TemplateFlowNode,
} from '../../moddle/templates/types';

export type MaterializeTemplateFlowCommand = {
  type: 'materialize-template-flow';
  modeling: any;
  templatesService: {
    createFlowNodeShape: (definition: TemplateFlowNode, parent: any) => any;
    createFlowConnection: (
      definition: TemplateFlowConnection,
      source: any,
      target: any,
      parent: any,
    ) => any;
  };
  shape: any;
  newRootElement?: any;
  hintKey: string;
};

export function runMaterializeTemplateFlow(
  command: MaterializeTemplateFlowCommand,
): void {
  const {
    modeling,
    templatesService,
    shape,
    newRootElement,
    hintKey,
  } = command;

  if (!shape) {
    return;
  }

  const flowElements = shape[TEMPLATE_FLOW_ELEMENTS] as TemplateFlowElement[] | undefined;
  if (!Array.isArray(flowElements) || flowElements.length === 0) {
    return;
  }

  const flowContainer = newRootElement ?? shape;
  const nodeEntries = flowElements.filter(isFlowNode);
  const connectionEntries = flowElements.filter(isFlowConnection);
  const nodesById = new Map<string, any>();

  for (const nodeEntry of nodeEntries) {
    const nodeShape = templatesService.createFlowNodeShape(nodeEntry, flowContainer);
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
        `[templates] Skipping connection '${connectionEntry.id ?? connectionEntry.bpmnType}' because source or target was not found.`
      );
      continue;
    }

    const connection = templatesService.createFlowConnection(
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

  delete shape[TEMPLATE_FLOW_ELEMENTS];
}

function isFlowNode(entry: TemplateFlowElement): entry is TemplateFlowNode {
  return entry.kind === 'node';
}

function isFlowConnection(entry: TemplateFlowElement): entry is TemplateFlowConnection {
  return entry.kind === 'connection';
}
