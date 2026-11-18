/** The reachy skill's contribution to the modeler: the parts of a robot study the New dialog lays out. */
import type { ModelerModule } from '@modeler/skillModules';

const module: ModelerModule = {
  starters: [
    { label: 'Greeting', intent: 'robot', order: 20, checked: true, steps: [{ extension: 'reachy:Interact', name: 'Say hello' }] },
    { label: 'Eye contact', intent: 'robot', order: 30, checked: true, steps: [{ extension: 'reachy:LookAt', name: 'Look at the person' }] },
    { label: 'Listening', intent: 'robot', order: 40, steps: [{ extension: 'reachy:Listen', name: 'Listen' }] },
  ],
};

export default module;
