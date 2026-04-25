import type { CommandContext } from '../types';

export type ToggleSimulationCommand = {
  type: 'toggle-simulation';
  currentActive: boolean;
};

export function runToggleSimulation(
  context: CommandContext,
  command: ToggleSimulationCommand,
): { active: boolean } {
  if (!context.modeler) {
    throw new Error("Command 'toggle-simulation' requires a modeler instance.");
  }

  const simulator = context.modeler.get('tokenSimulator');
  simulator.toggle();

  const next = !command.currentActive;
  const appRoot = document.querySelector('.App');
  if (appRoot) {
    appRoot.classList.toggle('simulation-active', next);
  }

  return { active: next };
}
