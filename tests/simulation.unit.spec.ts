import { expect, test } from '@playwright/test';

import type { ElementRecord } from '@canvas/index.ts';
import { tokenAnchor } from '@modeler/simulation/polyline';

/** Where the simulation and the replay draw a token. What a token does is the walk's (packages/core/tests/engine.unit.spec.ts). */
test('a token rests on the centre of a node, or on the top edge of an expanded container', () => {
  const shape = (extra: Partial<ElementRecord> = {}): ElementRecord =>
    ({ id: 'shape', kind: 'node', type: 'bpmn:SubProcess', bounds: { x: 0, y: 0, width: 100, height: 80 }, ...extra });
  expect(tokenAnchor(shape())).toEqual({ x: 50, y: 40 });
  expect(tokenAnchor(shape({ expanded: false }))).toEqual({ x: 50, y: 40 });
  expect(tokenAnchor(shape({ expanded: true, bounds: { x: 0, y: 0, width: 350, height: 200 } }))).toEqual({ x: 175, y: 0 });
});
