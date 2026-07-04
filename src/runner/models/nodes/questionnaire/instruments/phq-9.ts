import type { InstrumentDefinition } from '@/runner/models/nodes/questionnaire/instruments';

const SCALE = [
  { value: 0, label: 'Not at all' },
  { value: 1, label: 'Several days' },
  { value: 2, label: 'More than half the days' },
  { value: 3, label: 'Nearly every day' },
];

const PROMPTS = [
  'Little interest or pleasure in doing things',
  'Feeling down, depressed, or hopeless',
  'Trouble falling or staying asleep, or sleeping too much',
  'Feeling tired or having little energy',
  'Poor appetite or overeating',
  'Feeling bad about yourself - or that you are a failure or have let yourself or your family down',
  'Trouble concentrating on things, such as reading the newspaper or watching television',
  'Moving or speaking so slowly that other people could have noticed; or the opposite - being so fidgety or restless that you have been moving around a lot more than usual',
  'Thoughts that you would be better off dead, or of hurting yourself in some way',
];

export const phq9: InstrumentDefinition = {
  id: 'phq-9',
  title: 'Patient Health Questionnaire-9 (PHQ-9)',
  preamble: 'Over the last 2 weeks, how often have you been bothered by any of the following problems?',
  items: PROMPTS.map((prompt, i) => ({
    id: `phq9_${i + 1}`,
    prompt,
    scale: SCALE,
  })),
};
