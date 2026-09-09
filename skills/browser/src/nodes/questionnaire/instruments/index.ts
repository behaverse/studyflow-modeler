type InstrumentItem = {
  id: string;
  prompt: string;
  scale: { value: number; label: string }[];
};

export type InstrumentDefinition = {
  id: string;
  title: string;
  preamble?: string;
  items: InstrumentItem[];
};

const SCALE = [
  { value: 0, label: 'Not at all' },
  { value: 1, label: 'Several days' },
  { value: 2, label: 'More than half the days' },
  { value: 3, label: 'Nearly every day' },
];

const PHQ9_PROMPTS = [
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

const phq9: InstrumentDefinition = {
  id: 'phq-9',
  title: 'Patient Health Questionnaire-9 (PHQ-9)',
  preamble: 'Over the last 2 weeks, how often have you been bothered by any of the following problems?',
  items: PHQ9_PROMPTS.map((prompt, i) => ({
    id: `phq9_${i + 1}`,
    prompt,
    scale: SCALE,
  })),
};

const GAD7_PROMPTS = [
  'Feeling nervous, anxious, or on edge',
  'Not being able to stop or control worrying',
  'Worrying too much about different things',
  'Trouble relaxing',
  'Being so restless that it is hard to sit still',
  'Becoming easily annoyed or irritable',
  'Feeling afraid as if something awful might happen',
];

const gad7: InstrumentDefinition = {
  id: 'gad-7',
  title: 'Generalized Anxiety Disorder-7 (GAD-7)',
  preamble: 'Over the last 2 weeks, how often have you been bothered by the following problems?',
  items: GAD7_PROMPTS.map((prompt, i) => ({
    id: `gad7_${i + 1}`,
    prompt,
    scale: SCALE,
  })),
};

const bdi2: InstrumentDefinition = {
  id: 'bdi-ii',
  title: 'Beck Depression Inventory-II (BDI-II) - short form',
  preamble:
    'For each item, pick the statement that best describes how you have been feeling over the past two weeks, including today.',
  items: [
    {
      id: 'bdi2_sadness',
      prompt: 'Sadness',
      scale: [
        { value: 0, label: 'I do not feel sad.' },
        { value: 1, label: 'I feel sad much of the time.' },
        { value: 2, label: 'I am sad all the time.' },
        { value: 3, label: 'I am so sad or unhappy that I can’t stand it.' },
      ],
    },
    {
      id: 'bdi2_pessimism',
      prompt: 'Pessimism',
      scale: [
        { value: 0, label: 'I am not discouraged about my future.' },
        { value: 1, label: 'I feel more discouraged about my future than I used to.' },
        { value: 2, label: 'I do not expect things to work out for me.' },
        { value: 3, label: 'I feel my future is hopeless and will only get worse.' },
      ],
    },
    {
      id: 'bdi2_failure',
      prompt: 'Past failure',
      scale: [
        { value: 0, label: 'I do not feel like a failure.' },
        { value: 1, label: 'I have failed more than I should have.' },
        { value: 2, label: 'As I look back, I see a lot of failures.' },
        { value: 3, label: 'I feel I am a total failure as a person.' },
      ],
    },
    {
      id: 'bdi2_loss_pleasure',
      prompt: 'Loss of pleasure',
      scale: [
        { value: 0, label: 'I get as much pleasure as I ever did from things I enjoy.' },
        { value: 1, label: 'I don’t enjoy things as much as I used to.' },
        { value: 2, label: 'I get very little pleasure from the things I used to enjoy.' },
        { value: 3, label: 'I can’t get any pleasure from the things I used to enjoy.' },
      ],
    },
  ],
};

const REGISTRY: Record<string, InstrumentDefinition> = {
  'phq-9': phq9,
  phq9: phq9,
  'gad-7': gad7,
  gad7: gad7,
  'bdi-ii': bdi2,
  'bdi2': bdi2,
};

export function getInstrument(id: string | undefined): InstrumentDefinition | null {
  if (!id) return null;
  const key = id.toLowerCase().trim();
  return REGISTRY[key] ?? null;
}

/** Canonical ids only (the registry also carries unhyphenated aliases), for listing them in messages. */
export function listInstrumentIds(): string[] {
  return [...new Set(Object.values(REGISTRY).map((definition) => definition.id))];
}
