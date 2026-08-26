import { getEditorPort } from '@modeler/editor/bpmnAdapter';
import type { Modeler } from '@modeler/bpmn/types';

export type ToggleSimulationCommand = {
  type: 'ToggleSimulation';
};

export function runToggleSimulation(
  modeler: Modeler,
  _command: ToggleSimulationCommand,
): { active: boolean } {
  const { simulation } = getEditorPort(modeler);
  simulation.toggle();
  return { active: simulation.isActive() };
}
