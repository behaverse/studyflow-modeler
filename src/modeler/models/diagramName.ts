/** Canvas root BO `name`, or undefined; callers pick their own fallback. */
export function getDiagramName(modeler: any): string | undefined {
  const name = modeler?.get('canvas')?.getRootElement?.()?.businessObject?.name;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}
