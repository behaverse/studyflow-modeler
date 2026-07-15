import { silenceGetPadDeprecationWarning } from '@/modeler/controllers/contextpad/silenceDeprecationWarning';
import { TOGGLE_SIMULATION_EVENT } from '@/modeler/controllers/simulation/TokenSimulator';
import { swapChoreographyInitiator } from '@/modeler/models/choreographyParticipants';
import { isChoreographyTask } from '@/modeler/models/render/choreography';
import type { ContextPad, EventBus } from '@/modeler/infra/bpmn-js.d';

/** Two-arrows swap glyph for the "switch initiating participant" entry. */
const SWAP_INITIATOR_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" height="100%" width="100%" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M7 4 3 8l4 4"></path><path d="M3 8h13"></path>
    <path d="m17 20 4-4-4-4"></path><path d="M21 16H8"></path>
  </svg>
`;

/** Filters bpmn-js's contextPad: hides built-in append entries and closes during simulation. */
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

      // Choreography interactions have no single "condition" to flip; the one
      // choice is which participant initiates (BPMN's initiatingParticipantRef).
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
