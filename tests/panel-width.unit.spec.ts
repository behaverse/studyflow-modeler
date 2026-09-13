import { expect, test } from '@playwright/test';

import {
  clampPanelWidth,
  DEFAULT_PANEL_WIDTH,
  maxPanelWidth,
  MIN_PANEL_WIDTH,
} from '@modeler/inspector/panelWidth';

/** The inspector's width must stay usable at both ends: wide enough to read, never wide enough to take the canvas. */

test('the inspector panel stays between a legible minimum and half the window, and leaves the canvas room', () => {
  const CASES: Array<[string, number, number]> = [
    ['too narrow is raised to the minimum', clampPanelWidth(10, 1440), MIN_PANEL_WIDTH],
    ['a width in range stands', clampPanelWidth(400, 1440), 400],
    ['never past half the window', clampPanelWidth(5000, 1440), 720],
    ['the most a 1000px window allows is half', maxPanelWidth(1000), 500],
    ['600 is past half a 1000px window', clampPanelWidth(600, 1000), 500],
    // 900px wide: 320px of canvas has to survive, so the panel stops at 450.
    ['a narrow window keeps 320px of canvas', maxPanelWidth(900), 450],
    ['a window too narrow for both keeps the minimum', maxPanelWidth(400), MIN_PANEL_WIDTH],
    // Mounting before layout (or offscreen) reports 0; the stored width stands.
    ['a window that reports no width', clampPanelWidth(DEFAULT_PANEL_WIDTH, 0), DEFAULT_PANEL_WIDTH],
    ['a window that reports NaN', clampPanelWidth(DEFAULT_PANEL_WIDTH, Number.NaN), DEFAULT_PANEL_WIDTH],
    ['a stored width that is not a number', clampPanelWidth(Number.NaN, 1440), DEFAULT_PANEL_WIDTH],
  ];
  for (const [label, actual, expected] of CASES) expect(actual, label).toBe(expected);
});
