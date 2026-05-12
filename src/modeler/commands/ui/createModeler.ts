import BpmnModeler from 'bpmn-js/lib/Modeler';
import BpmnColorPickerModule from 'bpmn-js-color-picker';
import {
  CreateAppendAnythingModule,
  CreateAppendElementTemplatesModule,
} from 'bpmn-js-create-append-anything';
import GridModule from 'diagram-js-grid';

import new_diagram from '@/assets/examples/new_diagram.bpmn?raw';
import { StudyflowModelerModule } from '../..';

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
  /** Raw BPMN XML to import on boot. Takes precedence over `initialDiagramUrl`. */
  initialDiagramXml?: string;
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

  let diagramXML = command.initialDiagramXml;
  if (!diagramXML) {
    diagramXML = command.initialDiagramUrl
      ? await fetch(command.initialDiagramUrl).then((r) => r.text())
      : new_diagram;
  }
  await modeler.importXML(diagramXML);

  return modeler;
}
