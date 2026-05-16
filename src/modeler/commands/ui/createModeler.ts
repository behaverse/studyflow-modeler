import BpmnModeler from 'bpmn-js/lib/Modeler';
import BpmnColorPickerModule from 'bpmn-js-color-picker';
import {
  CreateAppendAnythingModule,
  CreateAppendElementTemplatesModule,
} from 'bpmn-js-create-append-anything';
import GridModule from 'diagram-js-grid';

import new_diagram from '@/assets/examples/new_diagram.bpmn?raw';
import { StudyflowModelerModule } from '../..';

const ADDITIONAL_MODULES = [
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
  /** Boot XML; falls back to the blank `new_diagram` template. */
  initialDiagramXml?: string;
};

export async function runCreateModeler(_modeler: any, command: CreateModelerCommand): Promise<any> {
  const modeler = new BpmnModeler({
    container: command.container,
    textRenderer: {
      defaultStyle: {
        fontFamily: '"IBM Plex Sans", Helvetica, sans-serif',
      },
    },
    moddleExtensions: command.extensionSchemas,
    additionalModules: ADDITIONAL_MODULES,
  });

  await modeler.importXML(command.initialDiagramXml ?? new_diagram);
  return modeler;
}
