/** The python skill's contribution to the modeler: the parts of an analysis the New dialog lays out, each a step its
 * runner calls (`python://<module>.<callable>`, to point at your own code). */
import type { ModelerModule } from '@modeler/skillModules';

const step = (name: string, entry: string) => ({ type: 'bpmn:ServiceTask', name, attributes: { implementation: `python://${entry}` } });

const module: ModelerModule = {
  starters: [
    { label: 'Data preparation', intent: 'analysis', order: 20, checked: true, steps: [step('Prepare the data', 'analysis.prepare')] },
    { label: 'Model fit', intent: 'analysis', order: 50, checked: true, steps: [step('Fit the model', 'analysis.fit')] },
    { label: 'Report', intent: 'analysis', order: 80, steps: [step('Write the report', 'analysis.report')] },
  ],
};

export default module;
