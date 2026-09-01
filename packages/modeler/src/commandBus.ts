import * as app from '@modeler/app/commands';
import * as diagram from '@modeler/diagram/commands';
import * as saveDiagram from '@modeler/diagram/save';
import * as exportDiagram from '@modeler/export/commands';
import * as inspector from '@modeler/inspector/commands';
import * as palette from '@modeler/palette/commands';
import * as popup from '@modeler/popup/commands';
import * as provenance from '@modeler/provenance/commands';
import * as publish from '@modeler/publish/commands';
import * as shape from '@modeler/shape/commands';
import * as simulation from '@modeler/simulation/commands';
import type { Editor } from '@modeler/editor/port';

/* A command joins the bus by being listed here; command type `X` dispatches to `runX`. */
const FEATURES = [
  app, diagram, exportDiagram, inspector, palette, popup, provenance, publish, saveDiagram, shape, simulation,
] as const;

type UnionToIntersection<U> =
  (U extends unknown ? (u: U) => void : never) extends (i: infer I) => void ? I : never;

type Handlers = UnionToIntersection<(typeof FEATURES)[number]>;

type RunKey = Extract<keyof Handlers, `run${string}`>;

export type ControllerCommand = { [K in RunKey]: Parameters<Handlers[K]>[1] }[RunKey];

type CommandResult<C extends ControllerCommand> = {
  [K in RunKey]: C extends Parameters<Handlers[K]>[1] ? Awaited<ReturnType<Handlers[K]>> : never;
}[RunKey];

/**
 * Dispatch `command` against the {@link Editor} (or `null`, at boot, for the
 * handlers that accept it) — the facade `runCreateModeler` built, which is the
 * only way a handler reaches the diagram.
 */
export async function executeCommand<C extends ControllerCommand>(
  modeler: Editor | null,
  command: C,
): Promise<CommandResult<C>> {
  const name = `run${command.type}`;
  const feature = FEATURES.find((f) => typeof (f as any)[name] === 'function');
  if (!feature) throw new Error(`No handler '${name}' for command '${command.type}'`);
  const result = await (feature as any)[name](modeler, command);
  // One stream: a finished command is announced beside `element.changed` & co., so a
  // feature can watch what the app DID without the caller wiring it. Facts only —
  // a thrown command announces nothing. `modeler` is null for the boot pair
  // (`DownloadSchemas`, `CreateModeler`), which run before there is a bus to say it on.
  modeler?.events.fire('command.done', { command, result });
  return result;
}

/**
 * Put the command bus ON the event bus: `events.fire('command', { type: 'Undo' })`
 * runs the command and hands back {@link executeCommand}'s promise.
 *
 * That is the half {@link executeCommand} cannot serve — it needs the `Editor`, and
 * the canvas is a leaf package that must not import `@modeler/*`. Anything holding
 * the bus can now REQUEST as well as observe, instead of inventing a bespoke topic
 * for the app to translate (which is what `keyboard.append` is).
 *
 * Called once at boot (`app/Modeler.tsx`); the subscription dies with the editor,
 * whose `destroy()` clears the bus.
 */
export function connectCommandBus(modeler: Editor): void {
  modeler.events.on('command', (command: ControllerCommand) => executeCommand(modeler, command));
}
