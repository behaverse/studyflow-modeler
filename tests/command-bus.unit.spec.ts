import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runSetColor } from '@modeler/shape/commands';
import type { Editor } from '@modeler/editor/port';

/** A handler touches the editor only through the {@link Editor} facade it is handed, never through
 * the backend itself — which is what lets a handler be exercised against a partial port, and what let the editor
 * be swapped underneath the app at all. `@modeler/commandBus` itself cannot be imported here: it
 * pulls in `app/commands.ts`, whose `?raw` asset import only resolves under Vite. So the contract is
 * tested where it lives, in a handler, and the call sites that depend on it are checked in the source. */

const SRC = join(process.cwd(), 'packages/modeler/src');
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

test('a handler goes through the port facade, so a partial port stands in for the editor', () => {
  const painted: unknown[] = [];
  const modeler = {
    mutate: {
      setColor: (elements: unknown, color: unknown) => painted.push({ elements, color }),
    },
  } as unknown as Editor;
  const elements = [{ id: 'Task_1' }];
  const color = { fill: '#eeeeee', stroke: '#333333' };

  runSetColor(modeler, { type: 'SetColor', elements, color });

  expect(painted, 'the handler reached the editor through `mutate` alone').toEqual([{ elements, color }]);
});

test('the colour picker really does dispatch `SetColor` with the editor', () => {
  // If this call site ever reached past the facade, the test above is guarding a contract nobody uses.
  const source = read('popup/PopupMenus.tsx');

  expect(source).toMatch(/executeCommand\(\s*modeler\s*,\s*\{\s*type:\s*'SetColor'/);
  expect(source, 'the editor is what the React tree holds, from `useRequiredModeler`')
    .toMatch(/const modeler = useRequiredModeler\(\)/);
});

test('every command the app boots with tolerates a null modeler', () => {
  // Boot dispatches before a modeler exists (`app/Modeler.tsx`), so those handlers must accept
  // null; that nullability is the only thing standing between boot and a crash.
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
