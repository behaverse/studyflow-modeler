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

/** Move `names` from `source` onto `target`, re-parenting what they hold; an unset, empty or default value stays behind. */
export function moveProperties(target: ModdleElement, source: ModdleElement, names: readonly string[]): void {
  const byName = source.$descriptor?.propertiesByName ?? {};
  for (const name of names) {
    const value = getProperty(source, name);
    if (value === undefined || (Array.isArray(value) && value.length === 0)) continue;
    // moddle materializes defaults on the prototype, so a default-equal value already reads back on the target.
    if (value === byName[name]?.default) continue;
    setProperty(target, name, value);
    setProperty(source, name, undefined);
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child === 'object' && '$parent' in child) child.$parent = target;
    }
  }
}

export function isModdleElement(value: unknown): value is ModdleElement {
  return !!value && typeof value === 'object' && typeof (value as any).$type === 'string';
}
