import { useState } from 'react';
import { readString, type FlowNode } from '@runner/flow';
import type { NodeProps } from '@runner/nodes/types';
import { NodePanel } from '@runner/nodes/NodePanel';
import { nodeStyles } from '@runner/nodes/styles';
import { registerNode } from '@runner/nodes/registry';
import { getInstrument, type InstrumentDefinition } from '@runner/nodes/questionnaire/instruments';
import { validateQuestionnaire } from '@runner/nodes/questionnaire/validation';

declare module '@runner/jobs' {
  interface JobsByType {
    questionnaire: QuestionnaireJob;
  }
}

type QuestionnaireJob = {
  type: 'questionnaire';
  node: FlowNode;
  instrument?: string;
};

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

/** No built-in item set for this instrument, so responses are texts */
function FallbackForm({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [text, setText] = useState('');

  return (
    <div className="flex flex-col gap-3">
      <p className={nodeStyles.subtitle}>Please respond in your own words.</p>
      <textarea
        className={nodeStyles.textarea}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type your response here..."
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

function Questionnaire({ job, session, log, complete }: NodeProps<QuestionnaireJob>) {
  const definition = getInstrument(job.instrument);
  const title = definition?.title || job.node.businessObject?.name || 'Questionnaire';
  const instrumentKey = job.instrument || 'unspecified';

  return (
    <NodePanel>
      <h2 className={nodeStyles.title}>{title}</h2>
      {definition ? (
        <LikertForm
          definition={definition}
          onSubmit={(responses) => {
            session.setVariable(`questionnaire.${instrumentKey}`, responses);
            log('ok', `Responded ${instrumentKey} (${Object.keys(responses).length} items).`);
            complete();
          }}
        />
      ) : (
        <FallbackForm
          onSubmit={(text) => {
            session.setVariable(`questionnaire.${instrumentKey}`, text);
            log('info', `Responded '${instrumentKey}' in free text (${text.length} chars); no built-in format set for it.`);
            complete();
          }}
        />
      )}
    </NodePanel>
  );
}

registerNode({
  type: 'questionnaire',
  match: { extensionType: 'cognitive:Questionnaire' },
  toJob: (node) => ({ type: 'questionnaire', node, instrument: readString(node, 'instrument') }),
  Component: Questionnaire,
  validateNode: validateQuestionnaire,
});
