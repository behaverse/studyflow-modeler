import { useEffect, useState } from 'react';

import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import {
  BpmnPropertiesPanelModule,
  BpmnPropertiesProviderModule,
} from 'bpmn-js-properties-panel';  
import '@bpmn-io/properties-panel/dist/assets/properties-panel.css'
import 'bpmn-js-token-simulation/assets/css/bpmn-js-token-simulation.css';
import {
    CreateAppendAnythingModule,
    CreateAppendElementTemplatesModule
  } from 'bpmn-js-create-append-anything';
import {
  CloudElementTemplatesPropertiesProviderModule
} from 'bpmn-js-element-templates';
import GridModule from 'diagram-js-grid';

import studyFlowElementTemplates from './assets/studyflow_templates';
import new_diagram from './assets/new_diagram.bpmn';
import StudyFlowModdleExtension from './assets/studyflow';
import {StudyFlowModule, ModelerContext, Toolbar} from './studyflow';
import { PropertiesProvider } from './studyflow/properties';

export function Modeler() {

    const [canvas, setCanvas] = useState(null);
    const [propertiesPanel, setPropertiesPanel] = useState(null);
    const [studyFlowModeler, setStudyFlowModeler] = useState(null);
    const [isLoading, setLoading] = useState(true);
  
    useEffect(() => {
        const modeler = new BpmnModeler({
            container: canvas,
            textRenderer: {
              defaultStyle: {
                fontFamily: '"IBM Plex Sans", Helvetica, sans-serif',
              }
            },
            propertiesPanel: {
                parent: propertiesPanel,
            },
            moddleExtensions: {
                studyflow: StudyFlowModdleExtension,
            },
            additionalModules: [
              BpmnPropertiesPanelModule,
              BpmnPropertiesProviderModule,
              CloudElementTemplatesPropertiesProviderModule,
              CreateAppendAnythingModule,
              CreateAppendElementTemplatesModule,
              GridModule,
              StudyFlowModule
            ],
            studyFlowElementTemplates,
        });
        setStudyFlowModeler(modeler);
        setLoading(false);

        fetch(new_diagram)
            .then(r => r.text())
            .then(content => {
                modeler.importXML(content)
                    .then(({ warnings }) => {
                        if (warnings.length) {
                          console.warn(warnings);
                        }
                        modeler.get('canvas').zoom('fit-viewport');
                      })
                      .catch(err => {
                        console.log(err);
                      });
            });

        return () => {
            modeler.destroy();
        }
    }, [canvas, propertiesPanel]);

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
      <ModelerContext.Provider value={studyFlowModeler}>
      <div className="flex flex-row h-full">
        <div className="grow border-gray-100 border-r-2" ref={setCanvas}>
        </div>
        <div className="basis-1/5" ref={setPropertiesPanel}></div>
        <Toolbar />
        </div>
        <PropertiesProvider />
      </ModelerContext.Provider>
    );
}
