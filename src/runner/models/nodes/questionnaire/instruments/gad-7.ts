import type { InstrumentDefinition } from '@/runner/models/nodes/questionnaire/instruments';

const SCALE = [
  { value: 0, label: 'Not at all' },
  { value: 1, label: 'Several days' },
  { value: 2, label: 'More than half the days' },
  { value: 3, label: 'Nearly every day' },
];

const PROMPTS = [
  'Feeling nervous, anxious, or on edge',
  'Not being able to stop or control worrying',
  'Worrying too much about different things',
  'Trouble relaxing',
  'Being so restless that it is hard to sit still',
  'Becoming easily annoyed or irritable',
  'Feeling afraid as if something awful might happen',
];

export const gad7: InstrumentDefinition = {
  id: 'gad-7',
  title: 'Generalized Anxiety Disorder-7 (GAD-7)',
  preamble: 'Over the last 2 weeks, how often have you been bothered by the following problems?',
  items: PROMPTS.map((prompt, i) => ({
    id: `gad7_${i + 1}`,
    prompt,
    scale: SCALE,
  })),
};
