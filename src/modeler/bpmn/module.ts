import StudyflowRenderer from '@/modeler/draw/Renderer';
import ChoreographyLabelEditing from '@/modeler/bpmn/ChoreographyLabelEditing';
import SimulationModule from '@/modeler/simulation/module';
import ContextPadModule from '@/modeler/contextPad/module';
import PaletteModule from '@/modeler/palette/module';
import StudyflowTemplatesModule from '@/modeler/templates/module';
import {
  GridVisibility,
  RemoveTemplatesFromPopup,
  ResizableTasks,
  StudyflowRules,
} from '@/modeler/bpmn/behaviors';

export const StudyflowModelerModule = {
  __init__: ['studyFlowRenderer', 'resizableTasks', 'studyflowRules', 'gridVisibility', 'removeTemplatesFromPopup'],
  __depends__: [
    SimulationModule,
    PaletteModule,
    ContextPadModule,
    StudyflowTemplatesModule,
  ],
  studyFlowRenderer: ['type', StudyflowRenderer],
  resizableTasks: ['type', ResizableTasks],
  studyflowRules: ['type', StudyflowRules],
  removeTemplatesFromPopup: ['type', RemoveTemplatesFromPopup],
  gridVisibility: ['type', GridVisibility],
  // Same DI key as bpmn-js's own provider — that is what replaces it.
  labelEditingProvider: ['type', ChoreographyLabelEditing],
};
