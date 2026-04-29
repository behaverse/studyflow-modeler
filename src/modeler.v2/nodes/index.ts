import { EventNode } from './EventNode';
import { ActivityNode } from './ActivityNode';
import { GatewayNode } from './GatewayNode';
import { DataStoreNode } from './DataStoreNode';
import { GroupNode } from './GroupNode';

export { EventNode, ActivityNode, GatewayNode, DataStoreNode, GroupNode };

export const nodeTypes = {
  eventNode: EventNode,
  activityNode: ActivityNode,
  gatewayNode: GatewayNode,
  dataStoreNode: DataStoreNode,
  groupNode: GroupNode,
} as const;
