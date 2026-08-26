import * as app from '@modeler/app/commands';
import * as diagram from '@modeler/diagram/commands';
import * as exportDiagram from '@modeler/export/commands';
import * as inspector from '@modeler/inspector/commands';
import * as palette from '@modeler/palette/commands';
import * as provenance from '@modeler/provenance/commands';
import * as publish from '@modeler/publish/commands';
import * as shape from '@modeler/shape/commands';
import * as simulation from '@modeler/simulation/commands';
import type { EditorHandle } from '@modeler/editor/registry';

/* A command joins the bus by being listed here; command type `X` dispatches to `runX`. */
const FEATURES = [app, diagram, exportDiagram, inspector, palette, provenance, publish, shape, simulation] as const;

type UnionToIntersection<U> =
  (U extends unknown ? (u: U) => void : never) extends (i: infer I) => void ? I : never;

type Handlers = UnionToIntersection<(typeof FEATURES)[number]>;

type RunKey = Extract<keyof Handlers, `run${string}`>;

export type ControllerCommand = { [K in RunKey]: Parameters<Handlers[K]>[1] }[RunKey];

type CommandResult<C extends ControllerCommand> = {
  [K in RunKey]: C extends Parameters<Handlers[K]>[1] ? Awaited<ReturnType<Handlers[K]>> : never;
}[RunKey];

/**
 * Dispatch `command` against the editor `handle` (or `null`, at boot, for the
 * handlers that accept it). The handle is opaque: it is either what
 * `runCreateModeler` built — a backend-neutral `PortHandle` — or a bare service
 * resolver, which is how the context pad dispatches (`this.injector`).
 */
export async function executeCommand<C extends ControllerCommand>(
  modeler: EditorHandle | null,
  command: C,
): Promise<CommandResult<C>> {
  const name = `run${command.type}`;
  const feature = FEATURES.find((f) => typeof (f as any)[name] === 'function');
  if (!feature) throw new Error(`No handler '${name}' for command '${command.type}'`);
  return (feature as any)[name](modeler, command);
}
