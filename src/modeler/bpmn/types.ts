import type BaseAutoPlace from 'diagram-js/lib/features/auto-place/AutoPlace';
import type BaseCanvas from 'diagram-js/lib/core/Canvas';
import type BaseContextPad from 'diagram-js/lib/features/context-pad/ContextPad';
import type BaseCreate from 'diagram-js/lib/features/create/Create';
import type BaseElementFactory from 'diagram-js/lib/core/ElementFactory';
import type BaseElementRegistry from 'diagram-js/lib/core/ElementRegistry';
import type BaseEventBus from 'diagram-js/lib/core/EventBus';
import type BasePopupMenu from 'diagram-js/lib/features/popup-menu/PopupMenu';
import type BaseRuleProvider from 'diagram-js/lib/features/rules/RuleProvider';
import type BaseRules from 'diagram-js/lib/features/rules/Rules';
import type BaseStyles from 'diagram-js/lib/draw/Styles';
import type BaseBpmnRenderer from 'bpmn-js/lib/draw/BpmnRenderer';
import type BaseModeling from 'bpmn-js/lib/features/modeling/Modeling';
import type BaseBpmnReplace from 'bpmn-js/lib/features/replace/BpmnReplace';

export type AutoPlace = BaseAutoPlace;
export type Canvas = BaseCanvas;
export type ContextPad = BaseContextPad;
export type Create = BaseCreate;
export type ElementFactory = BaseElementFactory;
export type ElementRegistry = BaseElementRegistry;
export type EventBus = BaseEventBus;
export type RuleProvider = BaseRuleProvider;
export type Rules = BaseRules;
export type Styles = BaseStyles;

export type Modeling = BaseModeling;

export type Replace = BaseBpmnReplace;

export type PopupMenu = Omit<BasePopupMenu, 'registerProvider'> & {
  registerProvider(id: string, provider: unknown): void;
  registerProvider(id: string, priority: number, provider: unknown): void;
};

export type Injector = import('didi').Injector;

export type Moddle = import('bpmn-moddle').BpmnModdle;

export type BpmnRenderer = Omit<BaseBpmnRenderer, 'handlers'> & {
  handlers: BaseBpmnRenderer['handlers'] &
    Record<string, (parentGfx: SVGElement, element: any, attrs?: object) => SVGElement>;
};

export type Services = {
  modeling: Modeling;
  canvas: Canvas;
  elementRegistry: ElementRegistry;
  eventBus: EventBus;
  moddle: Moddle;
  popupMenu: PopupMenu;
  contextPad: ContextPad;
  create: Create;
  elementFactory: ElementFactory;
  autoPlace: AutoPlace;
  rules: Rules;
  bpmnReplace: Replace;
  injector: Injector;
  bpmnFactory: any;
  commandStack: any;
  dragging: any;
  lassoTool: any;
  elementTemplates: any;
  tokenSimulator: any;
  textRenderer: any;
  bpmnRenderer: BpmnRenderer;
  styles: Styles;
};

export type ServiceResolver = {
  get<K extends keyof Services>(name: K): Services[K];
  get<K extends keyof Services>(name: K, strict: false): Services[K] | null;
};

export type Modeler = ServiceResolver & {
  getDefinitions(): any;
  importXML(xml: string): Promise<{ warnings: unknown[] }>;
  saveXML(options?: { format?: boolean }): Promise<{ xml: string }>;
  saveSVG(): Promise<{ svg: string }>;
  destroy(): void;
};
