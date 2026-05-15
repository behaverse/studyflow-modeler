import { useState } from 'react';
import { getProperty } from '@/lib/core/extensions/resolve';
import type { FlowNode } from '@/lib/core/flow';
import type { Study } from '@/runner/study';
import type { ValidationIssue } from '../behaverse/types';
import type { NodeProps } from '@/runner/nodes/types';
import { nodeStyles } from '../styles';
import { registerNode } from '../registry';
import { getInstrument, type InstrumentDefinition } from './instruments';

declare module '@/runner/types' {
  interface JobsByKind {
    questionnaire: QuestionnaireJob;
  }
}

export type QuestionnaireJob = {
  kind: 'questionnaire';
  node: FlowNode;
  instrument?: string;
};

export function questionnaireToJob(node: FlowNode): QuestionnaireJob {
  const instrument = (getProperty(node.businessObject, 'instrument') as string) || undefined;
  return { kind: 'questionnaire', node, instrument };
}

function LikertForm({
  definition,
  onSubmit,
}: {
  definition: InstrumentDefinition;
  onSubmit: (responses: Record<string, number>) => void;
}) {
  const [responses, setResponses] = useState<Record<string, number>>({});
  const allAnswered = definition.items.every((it) => it.id in responses);

  return (
    <div className="flex flex-col gap-4">
      {definition.preamble && <p className={nodeStyles.subtitle}>{definition.preamble}</p>}
      {definition.items.map((item, idx) => (
        <div key={item.id} className={nodeStyles.formItem}>
          <div className={nodeStyles.formPrompt}>
            <span className="font-medium mr-2">{idx + 1}.</span>
            {item.prompt}
          </div>
          <div className={nodeStyles.scaleRow}>
            {item.scale.map((opt) => {
              const selected = responses[item.id] === opt.value;
              return (
                <label
                  key={opt.value}
                  className={`${nodeStyles.scaleOption} ${
                    selected ? nodeStyles.scaleOptionSelected : ''
                  }`}
                >
                  <input
                    type="radio"
                    name={item.id}
                    value={opt.value}
                    checked={selected}
                    onChange={() =>
                      setResponses((r) => ({ ...r, [item.id]: opt.value }))
                    }
                    className="sr-only"
                  />
                  <span>{opt.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
      <div className={nodeStyles.actions}>
        <button
          type="button"
          disabled={!allAnswered}
          className={`${nodeStyles.primaryButton} ${
            allAnswered ? '' : 'opacity-50 cursor-not-allowed'
          }`}
          onClick={() => onSubmit(responses)}
        >
          Submit
        </button>
      </div>
    </div>
  );
}

function FallbackForm({
  instrument,
  onSubmit,
}: {
  instrument: string;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState('');

  return (
    <div className="flex flex-col gap-3">
      <p className={nodeStyles.subtitle}>
        Unrecognized instrument: <code className="font-mono">{instrument}</code>. Free-text response below.
      </p>
      <textarea
        className={nodeStyles.textarea}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type your response..."
      />
      <div className={nodeStyles.actions}>
        <button
          type="button"
          className={nodeStyles.primaryButton}
          onClick={() => onSubmit(text)}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

export function Questionnaire({ job, log, setVariable, complete }: NodeProps<QuestionnaireJob>) {
  const definition = getInstrument(job.instrument);
  const title =
    definition?.title || job.node.businessObject?.name || `Questionnaire: ${job.instrument || '(unspecified)'}`;
  const instrumentKey = job.instrument || 'unspecified';

  return (
    <div className={nodeStyles.card}>
      <div className={nodeStyles.panel}>
        <h2 className={nodeStyles.title}>{title}</h2>
        {definition ? (
          <LikertForm
            definition={definition}
            onSubmit={(responses) => {
              setVariable(`questionnaire.${instrumentKey}`, responses);
              log('ok', `Submitted ${instrumentKey} (${Object.keys(responses).length} items).`);
              complete(responses);
            }}
          />
        ) : (
          <FallbackForm
            instrument={instrumentKey}
            onSubmit={(text) => {
              setVariable(`questionnaire.${instrumentKey}`, text);
              log(
                'info',
                `Submitted ${instrumentKey} fallback (${text.length} chars).`,
              );
              complete(text);
            }}
          />
        )}
      </div>
    </div>
  );
}

export function validate(study: Study): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const node of study.nodes.values()) {
    if (node.extensionType !== 'cognitive:Questionnaire') continue;
    const instrument = (getProperty(node.businessObject, 'instrument') as string) || '';
    if (!instrument.trim()) {
      issues.push({
        nodeId: node.id,
        message: `Questionnaire '${node.id}' has no instrument set.`,
      });
    }
  }
  return issues;
}

registerNode({
  kind: 'questionnaire',
  match: { extensionType: 'cognitive:Questionnaire' },
  toJob: questionnaireToJob,
  Component: Questionnaire,
  validate,
});
