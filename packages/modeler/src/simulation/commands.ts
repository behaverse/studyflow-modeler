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

export type PauseSimulationCommand = {
  type: 'PauseSimulation';
};

/** Pauses a playing simulation, or resumes a paused one. */
export function runPauseSimulation(modeler: Editor, _command: PauseSimulationCommand): { paused: boolean } {
  const { simulation } = modeler;
  if (simulation.isPaused()) simulation.resume();
  else simulation.pause();
  return { paused: simulation.isPaused() };
}

export type StepSimulationCommand = {
  type: 'StepSimulation';
};

/** One step of a paused simulation: on until the next token reaches an element. */
export function runStepSimulation(modeler: Editor, _command: StepSimulationCommand): void {
  modeler.simulation.step();
}
