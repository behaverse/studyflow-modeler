import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runSetColor } from '@modeler/shape/commands';

/**
 * The bus takes anything that resolves services by name, so the modeler is one such thing and not the
 * only one. `@modeler/commandBus` itself cannot be imported here — it pulls in `app/commands.ts`, whose
 * `?raw` asset import only resolves under Vite — so the contract is tested where it lives, in a handler,
 * and the call sites that depend on it are checked in the source.
 */

const SRC = join(process.cwd(), 'packages/modeler/src');
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

test('a handler resolves its services by name, so a bare injector stands in for the modeler', () => {
  const painted: unknown[] = [];
  const modeling = {
    setColor: (elements: unknown, color: unknown) => painted.push({ elements, color }),
  };
  // Not a Modeler: exactly the shape bpmn-js's own injector has.
  const injector = { get: (name: string) => (name === 'modeling' ? modeling : undefined) };
  const elements = [{ id: 'Task_1' }];
  const color = { fill: '#eeeeee', stroke: '#333333' };

  runSetColor(injector as any, { type: 'SetColor', elements, color });

  expect(painted, 'the handler reached `modeling` through `get` alone').toEqual([{ elements, color }]);
});

test('the context pad really does dispatch with an injector', () => {
  // If this call site ever passes a modeler instead, the test above is guarding a contract nobody uses.
  const source = read('contextPad/ColorPickerProvider.ts');

  expect(source).toMatch(/executeCommand\(\s*this\.injector\s*,/);
  expect(source, "the injector is bpmn-js's, declared for injection").toMatch(/\$inject\s*=\s*\[[^\]]*'injector'/);
});

test('every command the app boots with tolerates a null modeler', () => {
  // Boot dispatches before a modeler exists (`app/Modeler.tsx`), so those handlers must accept null —
  // that nullability is the only thing standing between boot and a crash.
  const bootTypes = [...read('app/Modeler.tsx')
    .matchAll(/executeCommand\(\s*null\s*,\s*\{\s*\n?\s*type:\s*'([A-Z]\w*)'/g)]
    .map((match) => match[1]);

  expect(bootTypes.length, 'no null dispatch found — has boot changed?').toBeGreaterThan(0);

  const commands = read('app/commands.ts');
  const notNullable = bootTypes.filter((type) => {
    const signature = new RegExp(`function run${type}\\(\\s*_?\\w+:\\s*([^,)]+)`).exec(commands)?.[1] ?? '';
    return !/\|\s*null/.test(signature);
  });

  expect(notNullable, 'dispatched with null at boot, but the handler does not accept null').toEqual([]);
});
