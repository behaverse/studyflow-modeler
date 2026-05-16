export type ToggleSimulationCommand = {
  type: 'toggle-simulation';
};

export function runToggleSimulation(
  modeler: any,
  _command: ToggleSimulationCommand,
): { active: boolean } {
  const simulator = modeler.get('tokenSimulator');
  simulator.toggle();
  return { active: simulator.isActive() };
}
