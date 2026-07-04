import StudyflowRenderer from '@/modeler/views/render';
import ResizableTasks from '@/modeler/infra/ResizableTasks';
import StudyflowRules from '@/modeler/infra/StudyflowRules';
import ChoreographyLabelEditing from '@/modeler/controllers/ChoreographyLabelEditing';
import SimulationModule from '@/modeler/controllers/simulation';
import ContextPadModule from '@/modeler/controllers/contextpad';
import PaletteModule from '@/modeler/views/palette';
import StudyflowTemplatesModule from '@/modeler/infra/templates';

export const StudyflowModelerModule = {
  __init__: ['studyFlowRenderer', 'resizableTasks', 'studyflowRules'],
  __depends__: [
    SimulationModule,
    PaletteModule,
    ContextPadModule,
    StudyflowTemplatesModule,
  ],
  studyFlowRenderer: ['type', StudyflowRenderer],
  resizableTasks: ['type', ResizableTasks],
  studyflowRules: ['type', StudyflowRules],
  // Overrides bpmn-js's stock provider so choreography participant bands are
  // editable in place; every other element still uses the default behaviour.
  labelEditingProvider: ['type', ChoreographyLabelEditing],
};
