/** The choreography-task section: who takes each band, and what kind of actor that is. Pure helpers in `shape/choreographyParticipants.ts`. */
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
import { actorOf, isTypedChoreography, readChoreographyBands } from '@core/document';
import { StudyflowElement, isExtensionPrefix } from '@core/element';
import { getCatalog } from '@core/notation';
import { isPool, listParticipants, participantKind, participantKinds, type ParticipantKind } from '@modeler/shape/choreographyParticipants';
import { executeCommand } from '@modeler/commandBus';
import { useModeler } from '@modeler/app/useModeler';
import { InspectorContext } from '@modeler/inspector/hooks';
import { AttributeInput } from '@modeler/inspector/registry';
import { categoriesOf, isAttributeVisible } from '@modeler/inspector/categories';
import { HelpTooltip } from '@modeler/inspector/widgets';
import { PlainEnumSelect } from '@modeler/inspector/inputs';
import { field as s } from '@modeler/inspector/styles';

const TOP_HELP = 'Who takes the top band';
const BOTTOM_HELP = 'Who takes the bottom band';
const TAKER_HELP = 'Who takes this task: a drawn pool, or an actor declared for it. Empty, the pool the task sits in takes it.';
const INITIATOR_HELP = 'Which participant starts the interaction; its band is drawn light, the other shaded.';
const KIND_HELP = 'What takes this band, among the kinds the loaded extensions declare; the settings of that kind follow.';

export function ChoreographyParticipantsSection({ element }: { element: any }) {
  const businessObject = element?.businessObject ?? element;
  if (businessObject?.$type !== 'bpmn:ChoreographyTask') return null;
  return <ParticipantFields key={businessObject.id} element={element} />;
}

/** How a participant's kind reads: a drawn pool's is set on the pool, a band-only actor's on the band. */
function kindLabel(kind: ParticipantKind | undefined): string {
  return kind?.label ?? t('kindUntyped');
}

/**
 * One band of a choreography-shaped task, the same for a plain choreography task and a typed one (a cognitive
 * task): an editable select over every participant the file declares, text that names one or renames the band's
 * own, and "None" to clear it. A typed task has one such band, who takes it; empty, the pool it sits in does.
 */
function ParticipantField({ element, field, participant, label, help, declared, typed, fallback = '' }: {
  element: any; field: 'top' | 'bottom'; participant: any; label: string; help: string; declared: any[]; typed: boolean; fallback?: string;
}) {
  const modeler = useModeler();
  const [query, setQuery] = useState('');
  const name = participant?.name ?? fallback; // a plain task's band reads its placeholder until someone is named
  const kind = participantKind(participant);
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
    <>
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
              aria-label={`${field} participant`}
              className={s.comboInput}
              placeholder={typed ? t('participantFromPool') : undefined}
              displayValue={() => name}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { setQuery(''); commitText(e.currentTarget.value); } }}
              onBlur={(e) => { setQuery(''); commitText(e.currentTarget.value); }}
            />
            <ComboboxButton className={s.comboChevronBtn} aria-label={`${field} participant choices`}>
              <i className={s.comboChevronIcon} aria-hidden="true"></i>
            </ComboboxButton>
            <ComboboxOptions anchor="bottom start" className={s.comboOptions}>
              {!q && <ComboboxOption value="" className={s.comboOption}>{t('participantNone')}</ComboboxOption>}
              {options.map((p: any) => (
                <ComboboxOption key={p.id} value={p.id} className={s.comboOption}>
                  {p.name || p.id}{participantKind(p) ? ` (${kindLabel(participantKind(p))})` : ''}
                </ComboboxOption>
              ))}
            </ComboboxOptions>
          </Combobox>
        </div>
        {isPool(participant, modeler.canvas) && (
          <div className="mt-1 text-xs text-stone-500" data-testid={`choreography-${field}-kind`}>
            {t('participantKind')}: {kindLabel(kind)}
          </div>
        )}
      </Field>
      {participant && !isPool(participant, modeler.canvas)
        && <ActorFields key={participant.id} element={element} field={field} participant={participant} kind={kind} />}
    </>
  );
}

/** An actor that only takes bands has no shape to select: its kind, and the settings of that kind, are edited on the band. */
function ActorFields({ element, field, participant, kind }: {
  element: any; field: 'top' | 'bottom'; participant: any; kind: ParticipantKind | undefined;
}) {
  const modeler = useModeler();
  const kinds = [{ name: kindLabel(undefined), value: '' }, ...participantKinds().map((k) => ({ name: k.label, value: k.id }))];
  // Kind stands for the attribute that picks it; the rest of the extension's default-tab settings render as they would on a pool.
  const attrDefs = StudyflowElement.fromBusinessObject(participant).extensionAttributes()
    .filter((d) => (isExtensionPrefix(d.ns?.prefix) || !!d.redefines) && d.ns?.localName !== kind?.attribute)
    .filter((d) => categoriesOf(d).includes(getCatalog().defaultCategoryOf(d.ns?.prefix)))
    .sort((a, b) => (a.meta?.order ?? Infinity) - (b.meta?.order ?? Infinity));
  return (
    <InspectorContext.Provider value={{ element: participant }}>
      <Field className={s.field}>
        <Label className={s.label}>
          {t('participantKind')}
          <HelpTooltip name="participantKind" description={KIND_HELP} />
        </Label>
        <div data-testid={`choreography-${field}-kind`}>
          <PlainEnumSelect
            name={`choreography:${field}-kind`}
            ariaLabel={`${field} participant kind`}
            value={kind?.id ?? ''}
            literalValues={kinds}
            onCommit={(next) => executeCommand(modeler, { type: 'UpdateParticipantKind', element, participant, kind: next })}
          />
        </div>
      </Field>
      {attrDefs.filter((d) => isAttributeVisible(d, participant)).map((d) => (
        <Field key={d.ns.name} className={s.field}><AttributeInput attrDef={d} /></Field>
      ))}
    </InspectorContext.Provider>
  );
}

function ParticipantFields({ element }: { element: any }) {
  const modeler = useModeler();
  const bo = element.businessObject ?? element;
  const bands = readChoreographyBands(bo);
  const refs: any[] = bo.get?.('participantRef') ?? bo.participantRef ?? [];
  const declared = listParticipants(bo);
  const typed = isTypedChoreography(bo);
  const commitInitiator = (value: 'top' | 'bottom') =>
    executeCommand(modeler, { type: 'UpdateChoreographyParticipants', element, field: 'initiator', value });

  if (typed) {
    // A cognitive task presents itself (its upper band reads from the task); its one participant takes it.
    return <ParticipantField element={element} field="bottom" participant={actorOf(bo)} label={t('participant')} help={TAKER_HELP} declared={declared} typed />;
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
            <ListboxButton aria-label="Initiating participant" className={s.listboxBtn}>
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
