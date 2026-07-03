import BpmnModeler from 'bpmn-js/lib/Modeler';
import BpmnColorPickerModule from 'bpmn-js-color-picker';
import {
  CreateAppendAnythingModule,
  CreateAppendElementTemplatesModule,
} from 'bpmn-js-create-append-anything';
import GridModule from 'diagram-js-grid';

import new_diagram from '@/assets/examples/new_diagram.bpmn?raw';
import { normalizeStudyflowXml } from '@/lib/core/studyflowYaml';
import { fromWireXml } from '@/lib/core/choreographyRoot';
import { StudyflowModelerModule } from '../..';
import { clearAutosavedDiagram } from '../../settings/autosaveDiagram';

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

  const provided = command.initialDiagramXml;
  if (provided) {
    try {
      await modeler.importXML(await fromWireXml(normalizeStudyflowXml(provided), modeler.get('moddle')));
      return modeler;
    } catch (err) {
      // An autosaved or supplied diagram failed to import (schema drift, version
      // mismatch, corruption). Drop the autosave entry so we don't loop on it
      // and boot a fresh blank diagram instead.
      console.warn(
        'Failed to import the initial diagram; falling back to a new diagram. ' +
        'The autosaved entry (if any) has been cleared.',
        err,
      );
      clearAutosavedDiagram();
    }
  }
  await modeler.importXML(normalizeStudyflowXml(new_diagram));
  return modeler;
}
