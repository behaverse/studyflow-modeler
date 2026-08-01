import { toBusinessObject } from '@/core/extensions';
import { ensureChoreographyParticipants } from '@/modeler/models/choreographyParticipants';

export type UpdateChoreographyParticipantsCommand = {
  type: 'update-choreography-participants';
  /** The choreography task shape. */
  element: any;
} & (
  | { field: 'top' | 'bottom'; value: string }
  | { field: 'initiator'; value: 'top' | 'bottom' }
);

/**
 * Edit a choreography task's participants from the inspector — the same
 * native fields the canvas edits in place: a band rename writes the
 * referenced participant's `name`, the initiator choice writes
 * `initiatingParticipantRef`. A task that never had participants gets the
 * defaults materialized first, exactly as a band double-click would.
 */
export function runUpdateChoreographyParticipants(
  modeler: any,
  command: UpdateChoreographyParticipantsCommand,
): void {
  const modeling = modeler.get('modeling');
  const [top, bottom] = ensureChoreographyParticipants(command.element, modeling, modeler.get('bpmnFactory'));

  if (command.field === 'initiator') {
    const bo = toBusinessObject(command.element);
    const next = command.value === 'bottom' ? bottom : top;
    if (bo.get('initiatingParticipantRef') !== next) {
      modeling.updateModdleProperties(command.element, bo, { initiatingParticipantRef: next });
    }
    return;
  }

  const participant = command.field === 'top' ? top : bottom;
  modeling.updateModdleProperties(command.element, participant, { name: command.value });
}
