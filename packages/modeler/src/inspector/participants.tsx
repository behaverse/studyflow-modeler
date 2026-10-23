/** The choreography-task section: who takes each band; and the pool's section: what kind of actor it is. The edits are core's (`@core/model/choreography`), through the study's `bands` and `revise`. */
import {
  Combobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
  Field,
  Label,
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from '@headlessui/react';
import { useState } from 'react';
import { t } from '@modeler/i18n';
import { actorIn, bandsOf, isTypedChoreography } from '@core/model/choreography';
import { idOf, type Value } from '@core/model/index';
import { listParticipants, participantKind, participantKinds, type ParticipantKind } from '@core/model/choreography';
import { executeCommand } from '@modeler/commandBus';
import { useModeler } from '@modeler/app/useModeler';
import { useInspectedModel } from '@modeler/inspector/hooks';
import { HelpTooltip } from '@modeler/inspector/widgets';
import { PlainEnumSelect } from '@modeler/inspector/inputs';
import { field as s } from '@modeler/inspector/styles';

const TOP_HELP = 'The actor on the top band: a pool the study draws, or a name, which draws a new one.';
const BOTTOM_HELP = 'The actor on the bottom band: a pool the study draws, or a name, which draws a new one.';
const TAKER_HELP = 'The actor who takes this task: a pool the study draws, or a name, which draws a new one as a collapsed pool. Empty, whoever walks the pool the task sits in takes it.';
const INITIATOR_HELP = 'Which band starts the exchange; it is drawn light, the other shaded.';
const KIND_HELP = 'What kind of actor this pool is, among the kinds the loaded extensions declare; the settings of that kind follow.';

export function ChoreographyParticipantsSection({ element }: { element: any }) {
  const model = useInspectedModel();
  if (!element || model.host(element) !== 'bpmn:ChoreographyTask') return null;
  return <ParticipantFields key={element.id} element={element} />;
}

/** How an actor's kind reads: its pool's. */
function kindLabel(kind: ParticipantKind | undefined): string {
  return kind?.label ?? t('kindUntyped');
}

/**
 * One band of a choreography-shaped task, the same for a plain choreography task and a typed one (a cognitive
 * task): an editable select over every actor the file declares, text that names one or renames the band's own, and
 * "None" to clear it. A typed task has one such band, who takes it; empty, the pool it sits in does. The actor's kind
 * reads under the field; it is set on the pool, which the line selects.
 */
function ParticipantField({ element, field, participant, label, help, declared, typed, fallback = '' }: {
  element: any; field: 'top' | 'bottom'; participant: any; label: string; help: string; declared: any[]; typed: boolean; fallback?: string;
}) {
  const modeler = useModeler();
  const model = useInspectedModel();
  const [query, setQuery] = useState('');
  const name = participant?.name ?? fallback; // a plain task's band reads its placeholder until someone is named
  const kind = participantKind(model, participant);
  // Typing narrows the list to matching participants, so Enter on a name no one has commits the text itself.
  const q = query.trim().toLowerCase();
  const options = q ? declared.filter((p: any) => String(p.name ?? p.id).toLowerCase().includes(q)) : declared;
  const pick = (chosen: any | null) =>
    executeCommand(modeler, { type: 'UpdateChoreographyParticipants', element, field, select: chosen });
  const commitText = (text: string) => {
    const typedText = text.trim();
    if (!typedText || typedText === name) return;
    const match = declared.find((p: any) => String(p.name ?? '').toLowerCase() === typedText.toLowerCase());
    if (match) pick(match);
    else executeCommand(modeler, { type: 'UpdateChoreographyParticipants', element, field, value: typedText });
  };
  return (
    <Field className={s.field}>
      <Label className={s.label}>
        {label}
        <HelpTooltip name="participantRef" description={help} />
      </Label>
      <div className={s.selectWrapper}>
        <Combobox
          value={participant?.id ?? ''}
          onChange={(id: string | null) => {
            if (id === '') pick(null);
            else if (id) pick(declared.find((p: any) => p.id === id) ?? null);
          }}
        >
          <ComboboxInput
            name={`choreography:${field}`}
            aria-label={`${field} band`}
            className={s.comboInput}
            placeholder={typed ? t('participantFromPool') : undefined}
            displayValue={() => name}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setQuery(''); commitText(e.currentTarget.value); } }}
            onBlur={(e) => { setQuery(''); commitText(e.currentTarget.value); }}
          />
          <ComboboxButton className={s.comboChevronBtn} aria-label={`${field} band choices`}>
            <i className={s.comboChevronIcon} aria-hidden="true"></i>
          </ComboboxButton>
          <ComboboxOptions anchor="bottom start" className={s.comboOptions}>
            {!q && <ComboboxOption value="" className={s.comboOption}>{t('participantNone')}</ComboboxOption>}
            {options.map((p: any) => (
              <ComboboxOption key={p.id} value={p.id} className={s.comboOption}>
                {p.name || p.id}{participantKind(model, p) ? ` (${kindLabel(participantKind(model, p))})` : ''}
              </ComboboxOption>
            ))}
          </ComboboxOptions>
        </Combobox>
      </div>
      {participant && (
        <div className="mt-1 text-xs text-stone-500" data-testid={`choreography-${field}-kind`}>
          {t('participantKind')}: {kindLabel(kind)}
          {' · '}
          <button
            type="button"
            className={s.overriddenSource}
            title={t('participantPool')}
            onClick={() => executeCommand(modeler, { type: 'SelectElement', id: String(participant.id) })}
          >
            {t('participantPool')}
          </button>
        </div>
      )}
    </Field>
  );
}

/**
 * A pool's kind, on the pool: a person, a program, a device, a model, among the kinds the loaded extensions declare,
 * for a pool no schema types yet. Typed, the kind is the type's own attribute (`actorType`), and the settings of that
 * kind, which the tab lists with the rest.
 */
export function ActorKindSection({ element }: { element: any }) {
  const modeler = useModeler();
  const model = useInspectedModel();
  if (!element || model.host(element) !== 'bpmn:Participant' || model.extensionType(element)) return null;
  const kinds = [{ name: kindLabel(undefined), value: '' }, ...participantKinds().map((k) => ({ name: k.label, value: k.id }))];
  return (
    <Field className={s.field}>
      <Label className={s.label}>
        {t('participantKind')}
        <HelpTooltip name="participantKind" description={KIND_HELP} />
      </Label>
      <div data-testid="participant-kind">
        <PlainEnumSelect
          name="participant:kind"
          ariaLabel="Actor kind"
          value={participantKind(model, element)?.id ?? ''}
          literalValues={kinds}
          onCommit={(next) => executeCommand(modeler, { type: 'UpdateParticipantKind', element, kind: next })}
        />
      </div>
    </Field>
  );
}

function ParticipantFields({ element }: { element: any }) {
  const modeler = useModeler();
  const model = useInspectedModel();
  const bands = bandsOf(model, element);
  const refs = (Array.isArray(element.participantRef) ? element.participantRef : []).map((ref: Value) => model.get(idOf(ref) ?? undefined));
  const declared = listParticipants(model);
  const typed = isTypedChoreography(model, element);
  const commitInitiator = (value: 'top' | 'bottom') =>
    executeCommand(modeler, { type: 'UpdateChoreographyParticipants', element, field: 'initiator', value });

  if (typed) {
    // A cognitive task presents itself (its upper band reads from the task); its one participant takes it.
    return <ParticipantField element={element} field="bottom" participant={actorIn(model, element)} label={t('participant')} help={TAKER_HELP} declared={declared} typed />;
  }

  return (
    <>
      <ParticipantField element={element} field="top" participant={refs[0]} label={t('participantTop')} help={TOP_HELP} declared={declared} typed={false} fallback={bands.top} />
      <ParticipantField element={element} field="bottom" participant={refs[1]} label={t('participantBottom')} help={BOTTOM_HELP} declared={declared} typed={false} fallback={bands.bottom} />
      <Field className={s.field}>
        <Label className={s.label}>
          {t('initiatingParticipant')}
          <HelpTooltip name="initiatingParticipantRef" description={INITIATOR_HELP} />
        </Label>
        <div className={s.selectWrapper}>
          <Listbox value={bands.initiator} onChange={commitInitiator}>
            <ListboxButton aria-label="Initiator" className={s.listboxBtn}>
              {bands.initiator === 'top' ? bands.top : bands.bottom}
            </ListboxButton>
            <span className={s.comboChevronIndicator} aria-hidden="true">
              <i className={s.comboChevronIcon}></i>
            </span>
            <ListboxOptions anchor="bottom start" className={s.listboxOptions}>
              <ListboxOption value="top" className={s.comboOption}>{bands.top}</ListboxOption>
              <ListboxOption value="bottom" className={s.comboOption}>{bands.bottom}</ListboxOption>
            </ListboxOptions>
          </Listbox>
        </div>
      </Field>
    </>
  );
}
