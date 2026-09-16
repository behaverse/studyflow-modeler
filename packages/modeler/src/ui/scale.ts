/** The UI scale as a plain factor: 1 at the 16px root, which is also what jsdom reports. See `--ui-scale` in `assets/css/app.css`. */
export function uiScale(): number {
  if (typeof document === 'undefined') return 1;
  const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(root) && root > 0 ? root / 16 : 1;
}
