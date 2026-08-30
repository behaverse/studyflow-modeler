import type { Editor } from '@modeler/editor/port';

export type ToggleSimulationCommand = {
  type: 'ToggleSimulation';
};

export function runToggleSimulation(
  modeler: Editor,
  _command: ToggleSimulationCommand,
): { active: boolean } {
  const { simulation } = modeler;
  simulation.toggle();
  return { active: simulation.isActive() };
}
