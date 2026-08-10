const CHOREOGRAPHY_TASK_TYPE = 'bpmn:ChoreographyTask';

const CHOREOGRAPHY_BAND_HEIGHT = 20;

/** Matches bpmn-js's own task corner radius. */
export const CORNER_RADIUS = 10;

export function bandPath(width: number, bandHeight: number, height: number, edge: 'top' | 'bottom'): string {
  const r = CORNER_RADIUS;
  if (edge === 'top') {
    return `M0,${bandHeight} L0,${r} Q0,0 ${r},0 L${width - r},0 Q${width},0 ${width},${r} L${width},${bandHeight} Z`;
  }
  const y = height - bandHeight;
  return `M0,${y} L${width},${y} L${width},${height - r} Q${width},${height} ${width - r},${height} L${r},${height} Q0,${height} 0,${height - r} Z`;
}

export function isChoreographyTask(element: any): boolean {
  const type = element?.type ?? element?.businessObject?.$type ?? element?.$type;
  return type === CHOREOGRAPHY_TASK_TYPE;
}

export function choreographyBandHeight(element: { height: number }): number {
  return Math.min(CHOREOGRAPHY_BAND_HEIGHT, Math.floor(element.height / 3));
}

export function fit(text: string, maxWidth: number, fontSize: number): string {
  const perChar = fontSize * 0.58;
  const maxChars = Math.max(1, Math.floor((maxWidth - 8) / perChar));
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(1, maxChars - 1)).trimEnd() + '…';
}

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
      // Deliberately overlong: `fit` ellipsizes the remainder on the last permitted line.
      current = `${current} ${words.slice(i).join(' ')}`;
      break;
    }
    lines.push(fit(current, maxWidth, fontSize));
    current = words[i];
  }
  if (current) lines.push(fit(current, maxWidth, fontSize));
  return lines;
}
