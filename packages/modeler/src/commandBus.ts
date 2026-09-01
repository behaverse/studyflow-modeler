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

function handlerFor(name: string): ((modeler: Editor | null, command: unknown) => unknown) | undefined {
  const feature = FEATURES.find((f) => typeof (f as any)[name] === 'function');
  return feature && (feature as any)[name];
}

/**
 * Dispatch `command`. With an {@link Editor} it goes over the editor's bus
 * (`events.send`), the same bus `ElementChanged` & co. travel on, so a finished
 * command lands on `CommandDone` beside them. `null` is boot (`DownloadSchemas`,
 * `CreateModeler`): there is no bus yet, so the handler is called directly.
 */
export async function executeCommand<C extends ControllerCommand>(
  modeler: Editor | null,
  command: C,
): Promise<CommandResult<C>> {
  if (modeler) return modeler.events.send<CommandResult<C>>(command);
  const run = handlerFor(`run${command.type}`);
  if (!run) throw new Error(`No handler for command '${command.type}'`);
  return (await run(null, command)) as CommandResult<C>;
}

/**
 * Register every `runX` as the one listener on topic `X`, so `events.send({ type: 'X' })`
 * runs it. That is what makes commands and events one mechanism: the canvas (a leaf
 * that cannot import `@modeler/*`) sends `OpenAppendMenu` on the bus it already holds.
 *
 * Called once at boot (`app/Modeler.tsx`); the subscriptions die with the editor,
 * whose `destroy()` clears the bus.
 */
export function connectCommandBus(modeler: Editor): void {
  for (const feature of FEATURES) {
    for (const name of Object.keys(feature)) {
      if (!name.startsWith('run')) continue;
      modeler.events.on(name.slice(3), (command: unknown) => (feature as any)[name](modeler, command));
    }
  }
}
