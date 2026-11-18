/** The cognitive skill's contribution to the modeler: the parts of an experiment the New dialog lays out. */
import type { ModelerModule } from '@modeler/skillModules';

const module: ModelerModule = {
  starters: [
    { label: 'Instructions', intent: 'experiment', order: 10, checked: true, steps: [{ extension: 'cognitive:Instruction', name: 'Instructions' }] },
    { label: 'Cognitive tasks', intent: 'experiment', order: 50, checked: true, steps: [
      { extension: 'cognitive:CognitiveTask', name: 'First task' },
      { extension: 'cognitive:CognitiveTask', name: 'Second task' },
    ] },
    { label: 'A break', intent: 'experiment', order: 60, steps: [{ extension: 'cognitive:Rest', name: 'Break' }] },
    { label: 'Questionnaire', intent: 'experiment', order: 80, checked: true, steps: [{ extension: 'cognitive:Questionnaire', name: 'Questionnaire' }] },
  ],
};

export default module;
