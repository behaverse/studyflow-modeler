/**
 * Framework-free layout/identity helpers for choreography-task rendering:
 * type check, band-height clamp, and text fit/wrap. The SVG drawing itself
 * lives in the render view.
 */

/** BPMN element type; the studyflow trait contributes the band attributes. */
export const CHOREOGRAPHY_TASK_TYPE = 'bpmn:ChoreographyTask';

/** Nominal height of each participant band (shrinks for very short tasks). */
export const CHOREOGRAPHY_BAND_HEIGHT = 20;

/** Corner radius, matched to bpmn-js task shapes. */
export const CORNER_RADIUS = 10;

/** Path for a horizontal band with rounded corners only on the outer edge. */
export function bandPath(width: number, bandHeight: number, height: number, edge: 'top' | 'bottom'): string {
  const r = CORNER_RADIUS;
  if (edge === 'top') {
    return `M0,${bandHeight} L0,${r} Q0,0 ${r},0 L${width - r},0 Q${width},0 ${width},${r} L${width},${bandHeight} Z`;
  }
  const y = height - bandHeight;
  return `M0,${y} L${width},${y} L${width},${height - r} Q${width},${height} ${width - r},${height} L${r},${height} Q0,${height} 0,${height - r} Z`;
}

/** True when the element (djs shape or business object) is a choreography task. */
export function isChoreographyTask(element: any): boolean {
  const type = element?.type ?? element?.businessObject?.$type ?? element?.$type;
  return type === CHOREOGRAPHY_TASK_TYPE;
}

/** Actual band height for an element, clamped so the middle name band survives. */
export function choreographyBandHeight(element: { height: number }): number {
  return Math.min(CHOREOGRAPHY_BAND_HEIGHT, Math.floor(element.height / 3));
}

/** Truncate text to roughly fit `maxWidth` at `fontSize`, adding an ellipsis. */
export function fit(text: string, maxWidth: number, fontSize: number): string {
  const perChar = fontSize * 0.58;
  const maxChars = Math.max(1, Math.floor((maxWidth - 8) / perChar));
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(1, maxChars - 1)).trimEnd() + '…';
}

/** Greedy word-wrap into at most `maxLines` lines; overflow is ellipsized. */
export function wrap(text: string, maxWidth: number, fontSize: number, maxLines: number): string[] {
  const perChar = fontSize * 0.58;
  const maxChars = Math.max(1, Math.floor((maxWidth - 8) / perChar));
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (let i = 0; i < words.length; i++) {
    const candidate = current ? `${current} ${words[i]}` : words[i];
    if (candidate.length <= maxChars || !current) {
      current = candidate;
      continue;
    }
    if (lines.length === maxLines - 1) {
      // Last permitted line: keep the rest so `fit` ellipsizes it below.
      current = `${current} ${words.slice(i).join(' ')}`;
      break;
    }
    lines.push(fit(current, maxWidth, fontSize));
    current = words[i];
  }
  if (current) lines.push(fit(current, maxWidth, fontSize));
  return lines;
}
