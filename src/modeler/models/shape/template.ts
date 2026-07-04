/** Pure helpers for creating shapes and connections from element templates. */

type Box = { x: number; y: number; width: number; height: number };

/** Straight-line waypoints connecting the centers of two shapes. */
export function createWaypoints(source: Box, target: Box): Array<{ x: number; y: number }> {
  return [
    { x: source.x + source.width / 2, y: source.y + source.height / 2 },
    { x: target.x + target.width / 2, y: target.y + target.height / 2 },
  ];
}

/** Coerce a value to a finite number, accepting numeric strings; else undefined. */
export function toFiniteNumber(value: any): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** Reads `width`/`height` (or bpmn-prefixed) out of `attributes` (removing them)
 *  and returns them as a shape-size object. Mutates the passed attribute bag. */
export function takeSize(attributes: Record<string, any>): { width?: number; height?: number } {
  const width = toFiniteNumber(attributes['bpmn:width'] ?? attributes.width);
  const height = toFiniteNumber(attributes['bpmn:height'] ?? attributes.height);

  delete attributes['bpmn:width'];
  delete attributes['bpmn:height'];
  delete attributes.width;
  delete attributes.height;

  return {
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  };
}
