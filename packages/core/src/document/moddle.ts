/** The moddle model: creates elements and resolves descriptors (typed in `src/declarations.d.ts`). */
export type Moddle = import('bpmn-moddle').BpmnModdle;

/** Deliberately permissive: moddle is untyped upstream, and plain parsed bags flow through the same code paths. */
export interface ModdleElement {
  $type?: string;
  $parent?: ModdleElement;
  $attrs?: Record<string, unknown>;
  $model?: any;
  $descriptor?: any;
  get?(name: string): any;
  set?(name: string, value: any): void;
  [key: string]: any;
}

/** moddle's own `element.get`, tolerating a plain parsed bag (no `get`) and a missing element. */
export function getProperty(target: ModdleElement | null | undefined, name: string): any {
  if (!target) return undefined;
  return typeof target.get === 'function' ? target.get(name) : target[name];
}

/** moddle's own `element.set`, which already routes names no descriptor declares into `$attrs`. */
export function setProperty(target: ModdleElement | null | undefined, name: string, value: any): void {
  if (typeof target?.set === 'function') target.set(name, value);
  else if (target) target[name] = value;
}

export function isModdleElement(value: unknown): value is ModdleElement {
  return !!value && typeof value === 'object' && typeof (value as any).$type === 'string';
}
