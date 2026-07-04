// Narrow type shims for the bpmn-js / diagram-js DI services we touch.

declare module 'tiny-svg' {
  export function append(parent: SVGElement, child: SVGElement): void;
  export function create(name: string, attrs?: Record<string, unknown>): SVGElement;
}

export type EventBus = {
  on(event: string, listener: (e: any) => void): void;
  on(event: string, priority: number, listener: (e: any) => void): void;
  off(event: string, listener: (e: any) => void): void;
  fire(event: string, payload?: any): any;
};

export type ElementFactory = {
  create(type: string, attrs?: Record<string, any>): any;
  createShape(attrs?: Record<string, any>): any;
};

export type Modeling = {
  setColor(elements: any | any[], color: { fill?: string; stroke?: string }): void;
  updateProperties(element: any, properties: Record<string, any>): void;
  removeElements(elements: any[]): void;
};

export type Moddle = {
  create(type: string, attrs?: Record<string, any>): any;
  registry: {
    typeMap: Record<string, any>;
    packageMap: Record<string, { enumerations?: any[] } | undefined>;
  };
};

export type PopupMenu = {
  registerProvider(id: string, provider: unknown): void;
  open(element: any, providerId: string, position: { x: number; y: number }): void;
  close(): void;
};

export type ContextPad = {
  registerProvider(provider: unknown): void;
  registerProvider(priority: number, provider: unknown): void;
  close?(): void;
  getPad?(target: any): any;
};

export type Replace = {
  replaceElement(element: any, target: { type: string }): any;
};

export type Rules = {
  allowed(action: string, context?: Record<string, unknown>): boolean;
};

export type Create = {
  start(event: any, element: any, context?: Record<string, unknown>): void;
};

export type AutoPlace = {
  append(source: any, shape: any, hints?: Record<string, unknown>): any;
};

export type Injector = {
  get<T = any>(name: string): T;
  get<T = any>(name: string, strict: boolean): T | undefined;
};

export type Styles = {
  computeStyle(custom: Record<string, unknown>, defaults: Record<string, unknown>): Record<string, unknown>;
};

// Default bpmn-js renderer; delegated to for unhandled element types.
export type BpmnRenderer = {
  handlers: Record<string, (parentNode: SVGElement, element: any) => SVGElement>;
};
