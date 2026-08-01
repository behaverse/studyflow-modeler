import {
  Field, Input, Label, Listbox, ListboxButton, ListboxOption, ListboxOptions,
} from '@headlessui/react';
import { useState } from 'react';
import { readChoreographyBands } from '@/core/codec/choreography';
import { executeCommand } from '@/modeler/controllers/commandBus';
import { useModeler } from '@/modeler/views/useModeler';
import { HelpTooltip } from '@/modeler/views/inspector/HelpTooltip';
import { field as s } from '@/modeler/infra/styles';

const TOP_HELP = 'Name of the participant in the top band — BPMN’s own '
  + '`participantRef` (top band first). Double-clicking the band edits the same field.';
const BOTTOM_HELP = 'Name of the participant in the bottom band — the second '
  + 'of BPMN’s `participantRef` entries. Double-clicking the band edits the same field.';
const INITIATOR_HELP = 'Which participant initiates the interaction — BPMN’s '
  + '`initiatingParticipantRef`. The initiating band is drawn light, the other shaded.';

/**
 * A choreography task's participants, edited from the inspector — the same
 * native fields the canvas edits in place (band double-click, context-pad
 * swap). Nothing is declared in a schema for this: `participantRef` and
 * `initiatingParticipantRef` are the standard's own, used as-is.
 */
export function ChoreographyParticipantsSection({ element }: { element: any }) {
  const businessObject = element?.businessObject ?? element;
  if (businessObject?.$type !== 'bpmn:ChoreographyTask') return null;
  return <ParticipantFields key={businessObject.id} element={element} />;
}

function ParticipantFields({ element }: { element: any }) {
  const modeler = useModeler();
  const bands = readChoreographyBands(element.businessObject ?? element);
  const [top, setTop] = useState(bands.top);
  const [bottom, setBottom] = useState(bands.bottom);

  const commitBand = (field: 'top' | 'bottom', value: string) =>
    executeCommand(modeler, { type: 'update-choreography-participants', element, field, value });

  const commitInitiator = (value: 'top' | 'bottom') =>
    executeCommand(modeler, { type: 'update-choreography-participants', element, field: 'initiator', value });

  return (
    <>
      <Field className={s.field}>
        <Label className={s.label}>
          Top participant
          <HelpTooltip name="participantRef" description={TOP_HELP} />
        </Label>
        <Input
          type="text"
          name="choreography:top"
          value={top}
          onChange={(e) => { setTop(e.target.value); commitBand('top', e.target.value); }}
          className={s.textInput}
        />
      </Field>
      <Field className={s.field}>
        <Label className={s.label}>
          Bottom participant
          <HelpTooltip name="participantRef" description={BOTTOM_HELP} />
        </Label>
        <Input
          type="text"
          name="choreography:bottom"
          value={bottom}
          onChange={(e) => { setBottom(e.target.value); commitBand('bottom', e.target.value); }}
          className={s.textInput}
        />
      </Field>
      <Field className={s.field}>
        <Label className={s.label}>
          Initiating participant
          <HelpTooltip name="initiatingParticipantRef" description={INITIATOR_HELP} />
        </Label>
        <div className={s.selectWrapper}>
          <Listbox value={bands.initiator} onChange={commitInitiator}>
            <ListboxButton aria-label="Initiating participant" className={s.listboxBtn}>
              {bands.initiator === 'top' ? top : bottom}
            </ListboxButton>
            <span className={s.comboChevronIndicator} aria-hidden="true">
              <i className={s.comboChevronIcon}></i>
            </span>
            <ListboxOptions anchor="bottom start" className={s.listboxOptions}>
              <ListboxOption value="top" className={s.comboOption}>{top}</ListboxOption>
              <ListboxOption value="bottom" className={s.comboOption}>{bottom}</ListboxOption>
            </ListboxOptions>
          </Listbox>
        </div>
      </Field>
    </>
  );
}
