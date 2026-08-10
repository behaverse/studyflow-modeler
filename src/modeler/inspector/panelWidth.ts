export const DEFAULT_PANEL_WIDTH = 288;

export const MIN_PANEL_WIDTH = 240;

const HARD_MAX_PANEL_WIDTH = 720;

/** Never past half the viewport, and never leaving the canvas less than a palette's worth of room. */
export function maxPanelWidth(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return HARD_MAX_PANEL_WIDTH;

  const roomForCanvas = viewportWidth - 320;
  return Math.max(MIN_PANEL_WIDTH, Math.min(HARD_MAX_PANEL_WIDTH, viewportWidth / 2, roomForCanvas));
}

export function clampPanelWidth(width: number, viewportWidth: number): number {
  if (!Number.isFinite(width)) return DEFAULT_PANEL_WIDTH;
  return Math.round(Math.min(Math.max(width, MIN_PANEL_WIDTH), maxPanelWidth(viewportWidth)));
}
