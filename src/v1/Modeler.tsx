import { useEffect, useState, useContext, use } from 'react';

import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import BpmnColorPickerModule from 'bpmn-js-color-picker';
import 'bpmn-js-color-picker/colors/color-picker.css';

import {
    CreateAppendAnythingModule,
    // CreateAppendElementTemplatesModule
  } from 'bpmn-js-create-append-anything';
import GridModule from 'diagram-js-grid';

import {convertLinkMLToModdleObject} from '@/v1/linkml2moddle';
import new_diagram from '@/assets/new_diagram.bpmn';
import { ModelerContext } from './contexts';
import { StudyflowModelerModule } from '.';

// FIXME should be const _url = "https://behaverse.org/schemas/studyflow/schema.linkml.yaml";
const schemaFiles = import.meta.glob('@/assets/schemas/*.linkml.yaml', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export function Modeler() {

    const [canvas, setCanvas] = useState<HTMLDivElement | null>(null);
    const { setModeler } = useContext(ModelerContext);
    const [isLoading, setLoading] = useState(true);

  async function downloadSchemas(schemas: any): Promise<any> {

    const downloadedSchemas: any = {};
    for (const k of schemas) {
      // TODO fixme use the url instead of embedding the file in the bundle
      const _url = schemaFiles[`/assets/schemas/${k}.linkml.yaml`];
      console.log('Downloading schema:', k, _url, schemaFiles);
      const response = await fetch(_url);
      const text = await response.text();
      downloadedSchemas[k] = convertLinkMLToModdleObject(text);
    }
    console.log('Downloaded and converted schemas:', downloadedSchemas);
    return downloadedSchemas;
  }

  async function createModeler(extensionSchemas: any, _canvas: any = canvas) {
    const options = {
      container: _canvas,
      textRenderer: {
        defaultStyle: {
          fontFamily: '"IBM Plex Sans", Helvetica, sans-serif',
        }
      },
      moddleExtensions: extensionSchemas,
      additionalModules: [
        CreateAppendAnythingModule,
        BpmnColorPickerModule,
        // CreateAppendElementTemplatesModule,
        GridModule,
        StudyflowModelerModule
      ],
      // studyFlowElementTemplates,
    }

    const modeler = new BpmnModeler(options);
    const diagramXML = await fetch(new_diagram).then(r => r.text());
    await modeler.importXML(diagramXML);
    return modeler;
  }

  useEffect(() => {
    downloadSchemas(["omniflow", "studyflow"])
      .then(schemas => createModeler(schemas))
      .then(modeler => {
        setModeler(modeler);
        setLoading(false);
      })
      .catch(err => console.log('Error creating modeler:', err));

    return () => {
      // modeler.destroy();
    }
  }, [canvas, setModeler]);

  if (isLoading) {
    return (
      <div className="flex h-full text-center">
        <div role="status" className="m-auto animate-spin">
          <span className="bi bi-arrow-repeat text-fuchsia-600 text-[3rem]"></span>
          <span className="sr-only">Loading...</span>
        </div>
      </div>
    );
  }
  
    return (
        <div className="grow bg-amber-50" ref={setCanvas}></div>
    );
}
