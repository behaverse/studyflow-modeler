import { test, expect } from '@playwright/test';

import { EventBus } from '@canvas/bus.ts';

test('a command is a topic with one answering listener on the same bus the notifications use', async () => {
  // `send` is what makes the two mechanisms one: a leaf package (the canvas cannot import
  // `@modeler/*`) sends on the bus it already holds, and the fact lands on `CommandDone`.
  const bus = new EventBus();
  const seen: unknown[] = [];

  bus.on('ElementChanged', () => { seen.push('a'); });
  bus.on('ElementChanged', () => { seen.push('b'); });
  expect(bus.fire('ElementChanged', { element: {} }), 'a notification has no answer').toBeUndefined();
  expect(seen, 'every listener still runs, in subscription order').toEqual(['a', 'b']);

  bus.on('Undo', async (command: any) => `ran ${command.type}`);
  bus.on('CommandDone', (done) => seen.push(done));
  expect(await bus.send<string>({ type: 'Undo' })).toBe('ran Undo');
  // The fact is a message like any other: same `{ type, ... }` shape a command is sent in.
  expect(seen[2]).toEqual({ type: 'CommandDone', command: { type: 'Undo' }, result: 'ran Undo' });
  await expect(bus.send({ type: 'Nope' }), 'no handler').rejects.toThrow(/exactly one handler/);
});

