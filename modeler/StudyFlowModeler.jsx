import { useEffect, useState } from 'react';

import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import {
  BpmnPropertiesPanelModule,
  BpmnPropertiesProviderModule,
} from 'bpmn-js-properties-panel';  
import StudyFlowPropertiesProviderModule from './studyflow/properties';
import '@bpmn-io/properties-panel/dist/assets/properties-panel.css'
import 'bpmn-js-token-simulation/assets/css/bpmn-js-token-simulation.css';
import new_diagram from './assets/new_diagram.bpmn';
import StudyFlowModdleExtension from './assets/studyflow';
import StudyFlowModule from './studyflow';
import {ModelerContext} from './studyflow/ModelerContext';
import { Toolbar } from './studyflow/toolbar';
import {
    CreateAppendAnythingModule,
    CreateAppendElementTemplatesModule
  } from 'bpmn-js-create-append-anything';
import {
  CloudElementTemplatesPropertiesProviderModule
} from 'bpmn-js-element-templates';

import studyFlowElementTemplates from './assets/studyflow_templates';



export default function StudyFlowModeler() {

    const [canvas, setCanvas] = useState(null);
    const [propertiesPanel, setPropertiesPanel] = useState(null);
    const [studyFlowModeler, setStudyFlowModeler] = useState(null);

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
              StudyFlowPropertiesProviderModule,
              CloudElementTemplatesPropertiesProviderModule,
              CreateAppendAnythingModule,
              CreateAppendElementTemplatesModule,
              StudyFlowModule
            ],
            studyFlowElementTemplates,
        });

        // TODO wait for the modeler to be ready before importing the diagram
        setStudyFlowModeler(modeler);

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

    return (
      <ModelerContext.Provider value={studyFlowModeler}>
      <div className="flex flex-row h-full">
        <div className="grow border-gray-100 border-r-2" ref={setCanvas}>
        </div>
        <div className="basis-1/5" ref={setPropertiesPanel}></div>
        <Toolbar />
      </div>
      </ModelerContext.Provider>
    );
}
