/**
 * The New dialog's first question: what you are building, then which parts it has (`starters.ts`). Create lays the
 * parts out after a start event, turning their skills on.
 */

import { useState } from 'react';
import { notify } from '@modeler/app/noticeStore';
import { useModeler } from '@modeler/app/useModeler';
import { INTENTS, startFrom, startersFor, type OfferedStarter } from '@modeler/gallery/starters';
import { ICONS } from '@modeler/icons';
import type { StarterIntent } from '@modeler/skillModules';
import { button, choice, sectionLabel } from '@modeler/ui/styles';

const q = {
  root: 'mb-5 shrink-0',
  label: `${sectionLabel} mb-2`,
  intents: 'flex flex-wrap gap-2',
  intent: `inline-flex items-center gap-2 h-9 px-3.5 rounded-lg border text-sm font-medium transition-colors cursor-pointer`,
  intentIdle: 'border-black/[0.12] bg-field text-stone-700 hover:border-black/[0.24] hover:text-stone-900',
  intentPicked: 'border-accent bg-accent/[0.08] text-accent',
  parts: 'flex flex-wrap items-center gap-1.5 mt-3',
  part: choice.base,
  partIdle: `${choice.idle} ring-1 ring-black/[0.10]`,
  partPicked: choice.selected,
  create: `${button.base} ${button.primary} ms-auto`,
} as const;

export function Question({ onDone }: { onDone: () => void }) {
  const modeler = useModeler();
  const [intent, setIntent] = useState<StarterIntent>();
  const [picked, setPicked] = useState<ReadonlySet<OfferedStarter>>(new Set());
  const [busy, setBusy] = useState(false);
  const offered = intent ? startersFor(intent) : [];

  const choose = (next: StarterIntent) => {
    setIntent(next);
    setPicked(new Set(startersFor(next).filter((starter) => starter.checked)));
  };
  const toggle = (starter: OfferedStarter) => setPicked((now) => {
    const next = new Set(now);
    if (!next.delete(starter)) next.add(starter);
    return next;
  });
  const create = async () => {
    if (!modeler || busy) return;
    setBusy(true);
    try {
      await startFrom(modeler, offered.filter((starter) => picked.has(starter)));
      onDone();
    } catch (err) {
      notify('error', `Could not start the study: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={q.root} aria-label="Start from a question">
      <p className={q.label}>What are you building?</p>
      <div className={q.intents} role="radiogroup">
        {INTENTS.map(({ id, label, icon }) => (
          <button key={id} type="button" role="radio" aria-checked={intent === id} className={`${q.intent} ${intent === id ? q.intentPicked : q.intentIdle}`} onClick={() => choose(id)}>
            <i className={icon} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      {intent && (
        <div className={q.parts} role="group" aria-label="Parts">
          {offered.map((starter) => (
            <button key={`${starter.label}:${starter.schemas.join()}`} type="button" aria-pressed={picked.has(starter)} className={`${q.part} ${picked.has(starter) ? q.partPicked : q.partIdle}`} onClick={() => toggle(starter)}>
              {picked.has(starter) && <i className={ICONS.check} aria-hidden="true" />}
              {starter.label}
            </button>
          ))}
          <button type="button" className={q.create} disabled={busy || picked.size === 0} onClick={() => { void create(); }}>
            {busy && <i className={`${ICONS.spinner} animate-spin`} aria-hidden="true" />}
            Create
          </button>
        </div>
      )}
    </section>
  );
}
