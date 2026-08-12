import { expect, test } from '@playwright/test';

import {
  clampPanelWidth,
  DEFAULT_PANEL_WIDTH,
  maxPanelWidth,
  MIN_PANEL_WIDTH,
} from '@modeler/inspector/panelWidth';

/** The inspector's width must stay usable at both ends: wide enough to read, never wide enough to take the canvas. */

test.describe('inspector panel width', () => {
  test('stays between a legible minimum and half the viewport', () => {
    expect(clampPanelWidth(10, 1440)).toBe(MIN_PANEL_WIDTH);
    expect(clampPanelWidth(400, 1440)).toBe(400);
    expect(clampPanelWidth(5000, 1440)).toBe(720);
    expect(maxPanelWidth(1000)).toBe(500);
    expect(clampPanelWidth(600, 1000)).toBe(500);
  });

  test('leaves room for the canvas on a narrow window', () => {
    // 900px wide: 320px of canvas has to survive, so the panel stops at 450.
    expect(maxPanelWidth(900)).toBe(450);
    expect(maxPanelWidth(400)).toBe(MIN_PANEL_WIDTH);
  });

  test('a window that reports no width does not shrink the panel', () => {
    // Mounting before layout (or offscreen) reports 0; the stored width stands.
    expect(clampPanelWidth(DEFAULT_PANEL_WIDTH, 0)).toBe(DEFAULT_PANEL_WIDTH);
    expect(clampPanelWidth(DEFAULT_PANEL_WIDTH, Number.NaN)).toBe(DEFAULT_PANEL_WIDTH);
    expect(clampPanelWidth(Number.NaN, 1440)).toBe(DEFAULT_PANEL_WIDTH);
  });
});
