import { TEMPLATE_FLOW_ELEMENTS } from '../../moddle/templates/Templates';
import type {
  TemplateFlowConnection,
  TemplateFlowElement,
  TemplateFlowNode,
} from '../../moddle/templates/types';

type MaterializeTemplateFlowCommand = {
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

export function runMaterializeTemplateFlow(command: MaterializeTemplateFlowCommand): void {
  const { modeling, templatesService, shape, newRootElement, hintKey } = command;

  const flowElements: TemplateFlowElement[] = shape[TEMPLATE_FLOW_ELEMENTS] ?? [];
  if (flowElements.length === 0) return;

  const flowContainer = newRootElement ?? shape;
  const nodesById = new Map<string, any>();

  for (const node of flowElements.filter(isFlowNode)) {
    const nodeShape = templatesService.createFlowNodeShape(node, flowContainer);
    const created = modeling.createShape(
      nodeShape,
      { x: nodeShape.x, y: nodeShape.y, width: nodeShape.width, height: nodeShape.height },
      flowContainer,
      { autoResize: false, [hintKey]: true },
    );
    nodesById.set(node.id, created);
  }

  for (const conn of flowElements.filter(isFlowConnection)) {
    const source = nodesById.get(conn.sourceRef);
    const target = nodesById.get(conn.targetRef);
    if (!source || !target) {
      console.warn(`[templates] Skipping connection '${conn.id ?? conn.bpmnType}' - source or target not found.`);
      continue;
    }
    const created = templatesService.createFlowConnection(conn, source, target, flowContainer);
    modeling.createConnection(source, target, created, flowContainer, { [hintKey]: true });
  }

  delete shape[TEMPLATE_FLOW_ELEMENTS];
}

const isFlowNode = (e: TemplateFlowElement): e is TemplateFlowNode => e.kind === 'node';
const isFlowConnection = (e: TemplateFlowElement): e is TemplateFlowConnection => e.kind === 'connection';
