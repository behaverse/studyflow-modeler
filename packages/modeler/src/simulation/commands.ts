import { getEditorPort } from '@modeler/editor/registry';
import type { PortHandle } from '@modeler/editor/registry';

export type ToggleSimulationCommand = {
  type: 'ToggleSimulation';
};

export function runToggleSimulation(
  modeler: PortHandle,
  _command: ToggleSimulationCommand,
): { active: boolean } {
  const { simulation } = getEditorPort(modeler);
  simulation.toggle();
  return { active: simulation.isActive() };
}
