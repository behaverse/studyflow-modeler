/*
 * Inspector widths.
 *
 * The numbers below are the BASE-SCALE sizes, in CSS px at a 16px root: 288 is
 * 18rem, 240 is 15rem, 720 is 45rem. Everything that reads them multiplies by
 * the live UI scale (`--ui-scale`, `assets/css/app.css`), because the panel's
 * contents are rem-sized: a panel pinned at 288px on a 4K screen, where the type
 * inside it is half again as big, is a column of wrapped labels.
 *
 * Width stays state in px rather than rem because the drag that sets it is in px.
 */

export const DEFAULT_PANEL_WIDTH = 288;

export const MIN_PANEL_WIDTH = 240;

const HARD_MAX_PANEL_WIDTH = 720;

/** What the canvas keeps for itself: a palette, plus room to actually draw in. */
const ROOM_FOR_CANVAS = 320;

/** The UI scale as a plain factor — 1 at the 16px root, which is what jsdom reports. */
function uiScale(): number {
  if (typeof document === 'undefined') return 1;
  const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(root) && root > 0 ? root / 16 : 1;
}

/** Never past half the viewport, and never leaving the canvas less than a palette's worth of room. */
export function maxPanelWidth(viewportWidth: number): number {
  const scale = uiScale();
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return HARD_MAX_PANEL_WIDTH * scale;

  const roomForCanvas = viewportWidth - ROOM_FOR_CANVAS * scale;
  return Math.max(MIN_PANEL_WIDTH * scale, Math.min(HARD_MAX_PANEL_WIDTH * scale, viewportWidth / 2, roomForCanvas));
}

export function clampPanelWidth(width: number, viewportWidth: number): number {
  if (!Number.isFinite(width)) return DEFAULT_PANEL_WIDTH * uiScale();
  return Math.round(Math.min(Math.max(width, MIN_PANEL_WIDTH * uiScale()), maxPanelWidth(viewportWidth)));
}

/** The width a fresh panel (or a reset one) opens at, at the current scale. */
export function defaultPanelWidth(): number {
  return Math.round(DEFAULT_PANEL_WIDTH * uiScale());
}

/**
 * The stored width is in BASE-SCALE px, not screen px: a panel the user widened
 * by a third on a laptop opens a third wider on a 4K panel, instead of arriving
 * there at a literal 288px with 20px type wrapping inside it.
 */
export function fromStoredWidth(stored: number | undefined): number {
  return (stored ?? DEFAULT_PANEL_WIDTH) * uiScale();
}

export function toStoredWidth(width: number): number {
  return Math.round(width / uiScale());
}
