import { useEffect, useState, useContext } from 'react';

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
import studyflowSchema from '@/assets/studyflow.json';
import new_diagram from '@/assets/new_diagram.bpmn';
import { ModelerContext } from './contexts';
import { StudyflowModelerModule } from '.';

export function Modeler() {

    const [canvas, setCanvas] = useState(undefined);
    const { setModeler } = useContext(ModelerContext);
    const [isLoading, setLoading] = useState(true);

  async function downloadSchema(): Promise<any> {
    const _url = "https://raw.githubusercontent.com/behaverse/schemas/refs/heads/main/studyflow/schema.moddle.json"
    const response = fetch(_url).catch((error) => {
      console.error('Error fetching extension schema:', error);
      throw error;
    }).then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response;
    });

    return response.then((res) => res.json());
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
        studyflow: studyflowSchema,
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
    const _modeler = new BpmnModeler(options);
    setModeler(_modeler);
    setLoading(false);
    return _modeler;
  }

  useEffect(() => {
    downloadSchema().then(schema => {
      createModeler(schema).then((modeler) => {
        fetch(new_diagram).then(r => r.text()).then(content => {
            modeler.importXML(content).then(({ warnings }) => {
                if (warnings.length) {
                  console.warn(warnings);
                }
                modeler.get('canvas').zoom('fit-viewport');
              });
          });

        return () => {
          // modeler.destroy();
        };
      })
        .catch(err => {
          console.log('Error creating modeler:', err);
        });
    });
  }, [canvas, setModeler]);

  if (isLoading) {
    return (<div className="flex h-full text-center">
      <div role="status" className="m-auto animate-spin">
        <span className="bi bi-arrow-repeat text-fuchsia-600 text-[3rem]"></span>
        <span className="sr-only">Loading...</span>
      </div>
  </div>
    )
  }
  
    return (
        <div className="grow border-gray-100 border-r-2" ref={setCanvas}></div>
    );
}
