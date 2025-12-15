import { useEffect, useState, useContext, use } from 'react';

import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import BpmnColorPickerModule from 'bpmn-js-color-picker';
import 'bpmn-js-color-picker/colors/color-picker.css';
import 'bpmn-js-token-simulation/assets/css/bpmn-js-token-simulation.css';
import {
    CreateAppendAnythingModule,
    // CreateAppendElementTemplatesModule
  } from 'bpmn-js-create-append-anything';
import GridModule from 'diagram-js-grid';

// import studyFlowElementTemplates from './assets/studyflow_templates';
import {convertLinkMLToModdleObject} from '@/v2/linkml-to-moddle';
import new_diagram from '@/assets/new_diagram.bpmn';
import { ModelerContext } from './contexts';
import { StudyflowModelerModule } from '.';

export function Modeler() {

    const [canvas, setCanvas] = useState(undefined);
    const { setModeler } = useContext(ModelerContext);
    const [isLoading, setLoading] = useState(true);

  async function downloadSchema(): Promise<any> {
    const _url = "https://raw.githubusercontent.com/behaverse/schemas/refs/heads/main/studyflow/schema.linkml.yaml";
    const response = fetch(_url).catch((error) => {
      console.error('Error fetching extension schema:', error);
      throw error;
    }).then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response;
    });

    return response.then((res) => res.text()).then(convertLinkMLToModdleObject);
  }

  async function createModeler(schema: any, _canvas: any = canvas) {
    const options = {
      container: _canvas,
      textRenderer: {
        defaultStyle: {
          fontFamily: '"IBM Plex Sans", Helvetica, sans-serif',
        }
      },
      moddleExtensions: {
        studyflow: schema,
      },
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
    downloadSchema()
      .then(schema => createModeler(schema))
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
        <div className="grow border-gray-100 border-r-2" ref={setCanvas}></div>
    );
}
