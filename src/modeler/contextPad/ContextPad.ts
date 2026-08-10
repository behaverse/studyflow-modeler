import { TOGGLE_SIMULATION_EVENT } from '@/modeler/simulation/TokenSimulator';
import { swapChoreographyInitiator } from '@/modeler/bpmn/choreographyParticipants';
import { isChoreographyTask } from '@/modeler/draw/choreographyLayout';
import type { ContextPad, EventBus } from '@/modeler/bpmn/types';

const SWAP_INITIATOR_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" height="100%" width="100%" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M7 4 3 8l4 4"></path><path d="M3 8h13"></path>
    <path d="m17 20 4-4-4-4"></path><path d="M21 16H8"></path>
  </svg>
`;

/** Drop once bpmn-io/diagram-js#888 ships: silences the diagram-js 15 `getPad is deprecated` warning. */
function silenceGetPadDeprecationWarning(contextPad: { getPad?: (target: any) => any }): void {
  if (typeof contextPad.getPad !== 'function') return;

  const originalGetPad = contextPad.getPad.bind(contextPad);
  contextPad.getPad = function (target: any) {
    const originalWarn = console.warn;
    console.warn = (...args: any[]) => {
      if (args[0]?.message?.includes?.('ContextPad#getPad is deprecated')) return;
      originalWarn.apply(console, args);
    };
    try {
      return originalGetPad(target);
    } finally {
      console.warn = originalWarn;
    }
  };
}

export default class StudyflowContextPad {
  static $inject = ['contextPad', 'eventBus', 'modeling', 'bpmnFactory'];

  private _disabled = false;
  private _modeling: any;
  private _bpmnFactory: any;

  constructor(contextPad: ContextPad, eventBus: EventBus, modeling: any, bpmnFactory: any) {
    contextPad.registerProvider(this);
    this._modeling = modeling;
    this._bpmnFactory = bpmnFactory;

    eventBus.on(TOGGLE_SIMULATION_EVENT, ({ active }: { active: boolean }) => {
      this._disabled = !!active;
      if (active) contextPad.close?.();
    });

    silenceGetPadDeprecationWarning(contextPad);
  }

  getContextPadEntries(element: any) {
    return (entries: Record<string, any>) => {
      if (this._disabled) return {};
      delete entries['append.append-task'];
      delete entries['append.gateway'];
      delete entries['append.intermediate-event'];

      if (isChoreographyTask(element)) {
        entries['choreography.swap-initiator'] = {
          group: 'edit',
          title: 'Switch initiating participant',
          html: `<div class="entry" title="Switch initiating participant">${SWAP_INITIATOR_ICON}</div>`,
          action: {
            click: () => swapChoreographyInitiator(element, this._modeling, this._bpmnFactory),
          },
        };
      }
      return entries;
    };
  }
}
