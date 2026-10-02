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

export function isModdleElement(value: unknown): value is ModdleElement {
  return !!value && typeof value === 'object' && typeof (value as any).$type === 'string';
}
