import type { Modeler } from '@/modeler/bpmn/types';

export type ToggleSimulationCommand = {
  type: 'ToggleSimulation';
};

export function runToggleSimulation(
  modeler: Modeler,
  _command: ToggleSimulationCommand,
): { active: boolean } {
  const simulator = modeler.get('tokenSimulator');
  simulator.toggle();
  return { active: simulator.isActive() };
}
