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
import new_diagram from '../assets/new_diagram.bpmn';
import StudyFlowModdleExtension from '../assets/studyflow';
import { ModelerContext } from './contexts';
import { StudyFlowModule } from '.';

export function Modeler() {

    const [canvas, setCanvas] = useState(null);
    const { setModeler } = useContext(ModelerContext);
    const [isLoading, setLoading] = useState(true);
  
    useEffect(() => {
        const _modeler = new BpmnModeler({
            container: canvas,
            textRenderer: {
              defaultStyle: {
                fontFamily: '"IBM Plex Sans", Helvetica, sans-serif',
              }
            },
            moddleExtensions: {
                studyflow: StudyFlowModdleExtension,
            },
          additionalModules: [
            CreateAppendAnythingModule,
            BpmnColorPickerModule,
              // CreateAppendElementTemplatesModule,
              GridModule,
              StudyFlowModule
            ],
            // studyFlowElementTemplates,
        });
        setModeler(_modeler);
        setLoading(false);

        fetch(new_diagram)
            .then(r => r.text())
            .then(content => {
                _modeler.importXML(content)
                    .then(({ warnings }) => {
                        if (warnings.length) {
                          console.warn(warnings);
                        }
                        _modeler.get('canvas').zoom('fit-viewport');
                      })
                      .catch(err => {
                        console.log(err);
                      });
            });

        return () => {
            _modeler.destroy();
        }
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
