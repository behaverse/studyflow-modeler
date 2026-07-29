/**
 * How wide the inspector may be.
 *
 * The panel floats over the canvas on the right, so its width is a trade
 * against the canvas rather than a layout constraint: narrow enough to keep
 * the fields legible, never wide enough to leave the diagram without room.
 */

/** Matches the `w-72` the panel shipped with, and what a reset returns to. */
export const DEFAULT_PANEL_WIDTH = 288;

/** Below this, field labels and their inputs stop fitting side by side. */
export const MIN_PANEL_WIDTH = 240;

/** Widest the panel may ever get, whatever the viewport. */
const HARD_MAX_PANEL_WIDTH = 720;

/** Widest the panel may get here: never past half the viewport, and never so
 *  wide that the canvas has less than a palette's worth of room beside it. */
export function maxPanelWidth(viewportWidth: number): number {
  // A window that reports no width has not been laid out yet (or is offscreen);
  // constraining against it would shrink the panel to its minimum for nothing.
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return HARD_MAX_PANEL_WIDTH;

  const roomForCanvas = viewportWidth - 320;
  return Math.max(MIN_PANEL_WIDTH, Math.min(HARD_MAX_PANEL_WIDTH, viewportWidth / 2, roomForCanvas));
}

/** The nearest allowed width to `width` in a viewport this wide. */
export function clampPanelWidth(width: number, viewportWidth: number): number {
  if (!Number.isFinite(width)) return DEFAULT_PANEL_WIDTH;
  return Math.round(Math.min(Math.max(width, MIN_PANEL_WIDTH), maxPanelWidth(viewportWidth)));
}
