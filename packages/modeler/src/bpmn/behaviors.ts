import { is } from 'bpmn-js/lib/util/ModelUtil';
import RuleProvider from 'diagram-js/lib/features/rules/RuleProvider';
import { getCatalog } from '@core/notation';
import { StudyflowElement } from '@core/element';
import { getSettings, subscribeSettings } from '@modeler/settings/store';
import type { EventBus } from '@modeler/bpmn/types';

export class ResizableTasks extends RuleProvider {
  static $inject = ['bpmnRules', 'eventBus'];

  private _bpmnRules: any;

  constructor(bpmnRules: any, eventBus: any) {
    super(eventBus);
    this._bpmnRules = bpmnRules;
  }

  init() {
    this.addRule('shape.resize', Infinity, ({ shape, newBounds }: any) => {
      return is(shape, 'bpmn:Task')
        || is(shape, 'bpmn:SubProcess')
        || is(shape, 'bpmn:CallActivity')
        || is(shape, 'bpmn:ChoreographyTask')
        || this._bpmnRules.canResize(shape, newBounds);
    });
  }
}

/** Above bpmn-js's BpmnRules (priority 1000): schema rules win when declared. */
const SCHEMA_RULE_PRIORITY = 1500;

function typeRefOf(element: any): string | undefined {
  return StudyflowElement.fromBusinessObject(element).extensionType ?? element?.businessObject?.$type;
}

export class StudyflowRules extends RuleProvider {
  static $inject = ['eventBus'];

  init() {
    const evaluate = ({ source, target }: any): boolean | undefined => {
      if (!source || !target) return undefined;
      const verdict = getCatalog().connectionRule(typeRefOf(source), typeRefOf(target));
      return verdict === 'defer' ? undefined : verdict;
    };

    this.addRule('connection.create', SCHEMA_RULE_PRIORITY, evaluate);
    this.addRule('connection.reconnect', SCHEMA_RULE_PRIORITY, evaluate);
  }
}

/** Deliberate: templates are offered only through the studyflow palette, not bpmn-js's create popup. */
export class RemoveTemplatesFromPopup {
  static $inject = ['popupMenu'];

  constructor(popupMenu: any) {
    popupMenu.registerProvider('bpmn-create', this);
  }

  getPopupMenuEntries(_element: any) {
    return (entries: Record<string, any>) => {
      for (const key of Object.keys(entries)) {
        if (key.startsWith('create.template-')) delete entries[key];
      }
      return entries;
    };
  }
}

type Grid = { toggle(visible?: boolean): void };

/** Must outrank `diagram-js-grid`'s own `diagram.init`, which turns the grid on unconditionally. */
const AFTER_GRID_INIT = 500;

export class GridVisibility {
  static $inject = ['eventBus', 'injector'];

  private unsubscribe: (() => void) | undefined;

  constructor(eventBus: EventBus, injector: { get<T>(name: string, strict: boolean): T | null }) {
    const grid = injector.get<Grid>('grid', false);
    if (!grid) return;

    const apply = () => grid.toggle(getSettings().showGrid);

    eventBus.on('diagram.init', AFTER_GRID_INIT, apply);
    eventBus.on('diagram.destroy', () => this.unsubscribe?.());
    this.unsubscribe = subscribeSettings(apply);
  }
}
