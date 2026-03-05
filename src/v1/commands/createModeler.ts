import BpmnModeler from 'bpmn-js/lib/Modeler';
import BpmnColorPickerModule from 'bpmn-js-color-picker';
import {
  CreateAppendAnythingModule,
  CreateAppendElementTemplatesModule,
} from 'bpmn-js-create-append-anything';
import GridModule from 'diagram-js-grid';

import new_diagram from '@/assets/new_diagram.bpmn';
import { StudyflowModelerModule } from '..';

const DEFAULT_ADDITIONAL_MODULES = [
  CreateAppendAnythingModule,
  BpmnColorPickerModule,
  CreateAppendElementTemplatesModule,
  GridModule,
  StudyflowModelerModule,
];

export type CreateModelerCommand = {
  type: 'create-modeler';
  container: any;
  extensionSchemas: Record<string, any>;
  additionalModules?: any[];
  initialDiagramUrl?: string;
};

export async function runCreateModeler(command: CreateModelerCommand): Promise<any> {
  const modeler = new BpmnModeler({
    container: command.container,
    textRenderer: {
      defaultStyle: {
        fontFamily: '"IBM Plex Sans", Helvetica, sans-serif',
      },
    },
    moddleExtensions: command.extensionSchemas,
    additionalModules: command.additionalModules ?? DEFAULT_ADDITIONAL_MODULES,
  });

  const diagramXML = await fetch(command.initialDiagramUrl ?? new_diagram).then((r) => r.text());
  await modeler.importXML(diagramXML);

  return modeler;
}
