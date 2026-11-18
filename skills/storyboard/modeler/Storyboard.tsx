/**
 * The participant's storyboard, this skill's view in the canvas's place (`modeler.ts`): the study as the session
 * someone goes through.
 * Each step is a card in the order the session takes them (`session.ts`), with when it begins and how long it lasts,
 * and the session's total. A press selects a step, whose card then opens its fields; a + between two steps puts one
 * there, on the flow that joins them.
 */

import { Fragment, useMemo, type MouseEvent } from 'react';
import { BPMN } from '@core/constants';
import { useModeler } from '@modeler/app/useModeler';
import { executeCommand } from '@modeler/commandBus';
import { useSelection } from '@modeler/composer/hooks';
import { InlineInspector } from '@modeler/inspector/InlineInspector';
import { ICONS } from '@modeler/icons';
import { useInspectorWidth } from '@modeler/inspector/visibility';
import { addEntries } from '@modeler/palette/catalog';
import { unscheduledSteps } from '@modeler/schedule/rows';
import { sessionOf, spokenLength, spokenMinutes, type SessionStep } from '@skills/storyboard/modeler/session';
import { storyboard as s } from '@skills/storyboard/modeler/styles';
import { useStudyVersion } from '@modeler/views/hooks';
import { useViews } from '@modeler/views/store';
import { DRAWER_HEIGHT } from '@modeler/views/styles';

/** What the storyboard offers a session with steps of no length: a length for each, to change from there. */
const TYPICAL = 'PT5M';

const BOOKENDS = [BPMN.StartEvent, BPMN.EndEvent, 'bpmn:Gateway'];

export function Storyboard() {
  const modeler = useModeler();
  const version = useStudyVersion(modeler);
  const selection = useSelection(modeler);
  const inspector = useInspectorWidth();
  const views = useViews();
  const drawer = views.open && !views.maximized;
  const { model } = modeler.study;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` stands in for the study
  const session = useMemo(() => sessionOf(model), [model, version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` stands in for the catalog's types in use
  const entries = useMemo(() => addEntries(), [version]);
  const iconOf = (step: SessionStep): string | undefined =>
    entries.find((entry) => step.extension && entry.extensionType === step.extension)?.icon
    ?? entries.find((entry) => !entry.skill && entry.bpmnType === step.type)?.icon;

  const select = (id: string) => modeler.canvas.select([id]);
  const insertOn = (flow: string, event: MouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    void executeCommand(modeler, { type: 'OpenInsertMenu', edge: flow, at: { x: Math.round(box.right + 6), y: Math.round(box.top) } });
  };
  const giveLengths = () => modeler.study.batch({
    steps: unscheduledSteps(modeler).map((id) => ({ tool: 'set', args: { id, attribute: 'studyflow:duration', value: TYPICAL } })),
  });

  const bottom = drawer ? `calc(${DRAWER_HEIGHT} + 4.5rem)` : '4rem';
  return (
    <div className={s.root} style={{ right: inspector > 0 ? inspector + 16 : 8, bottom }} data-testid="storyboard">
      <div className={s.head}>
        <span className={s.total}>{spokenMinutes(session.total)}</span>
        <span>{session.steps.filter((step) => !BOOKENDS.some((type) => model.isA(model.get(step.id)!, type))).length} steps</span>
        {session.unknown > 0 && (
          <>
            <span>{session.unknown === 1 ? 'One step has no length.' : `${session.unknown} steps have no length.`}</span>
            <button type="button" className={s.fill} onClick={giveLengths}>Give each {spokenMinutes(5)}</button>
          </>
        )}
      </div>
      <ol className={s.strip}>
        {session.steps.map((step, index) => {
          const element = model.get(step.id)!;
          const bookend = BOOKENDS.some((type) => model.isA(element, type));
          const selected = selection.includes(step.id);
          const icon = iconOf(step);
          return (
            <Fragment key={step.id}>
              {index > 0 && (
                <li className={s.join} aria-hidden={!step.via}>
                  {step.via ? (
                    <button type="button" className={s.plus} title="Add a step here" aria-label={`Add a step before ${step.name || step.id}`} onClick={(event) => insertOn(step.via!, event)}>
                      <i className={ICONS.plus} aria-hidden="true" />
                    </button>
                  ) : <i className={ICONS.chevronRight} />}
                </li>
              )}
              <li>
                {bookend ? (
                  <button type="button" className={`${s.marker} ${selected ? s.markerSelected : ''}`} onClick={() => select(step.id)} data-step={step.id}>
                    {icon && <i className={`${icon} ${s.glyph}`} aria-hidden="true" />}
                    <span className="pt-1 text-sm font-medium text-stone-800 line-clamp-2">{step.name || (index === 0 ? 'Start' : 'End')}</span>
                    <span className="text-xs text-stone-500">
                      {step.ways ? `${step.ways} ways on` : index === 0 ? '0 min' : spokenMinutes(step.at)}
                    </span>
                  </button>
                ) : (
                  <div className={`${s.card} ${selected ? s.cardSelected : ''}`} data-step={step.id}>
                    <button type="button" className="flex flex-col flex-1 text-left cursor-pointer" onClick={() => select(step.id)}>
                      <span className={s.top}>
                        {icon && <i className={`${icon} ${s.glyph}`} aria-hidden="true" />}
                        <span className="ml-auto">at {spokenMinutes(step.at)}</span>
                      </span>
                      <span className={step.name ? s.name : s.unnamed}>{step.name || 'Unnamed step'}</span>
                      {step.description && <span className={s.description}>{step.description}</span>}
                      <span className={step.duration ? s.length : s.noLength}>{spokenLength(step) ?? 'No length'}</span>
                    </button>
                    {selected && <InlineInspector id={step.id} />}
                  </div>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </div>
  );
}
