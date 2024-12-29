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
import StudyFlowSimulationModule from './studyflow/simulation';
import 'bpmn-js-token-simulation/assets/css/bpmn-js-token-simulation.css';
import new_diagram from './assets/new_diagram.bpmn';
import StudyFlowModdleExtension from './assets/studyflow';
import StudyFlowModule from './studyflow';
import {
    CreateAppendAnythingModule,
    CreateAppendElementTemplatesModule
  } from 'bpmn-js-create-append-anything';
import {
  CloudElementTemplatesPropertiesProviderModule
} from 'bpmn-js-element-templates';

import studyFlowElementTemplates from './assets/studyflow_templates';
import StudyFlowPaletteProvider from './studyflow/PaletteProvider';

export default function StudyFlowModeler() {

    const [canvas, setCanvas] = useState(null);
    const [propertiesPanel, setPropertiesPanel] = useState(null);

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
                StudyFlowSimulationModule,
                BpmnPropertiesPanelModule,
                BpmnPropertiesProviderModule,
                StudyFlowModule,
                StudyFlowPaletteProvider,
                CloudElementTemplatesPropertiesProviderModule,
                CreateAppendAnythingModule,
                CreateAppendElementTemplatesModule,

            ],
            studyFlowElementTemplates,
        });

        // TODO wait for the modeler to be ready before importing the diagram


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
        <div className="flex flex-row h-full">
            <div className="grow" ref={setCanvas}
                style={{
                border: "2px solid #a31caf",
              }}></div>
            <div className="basis-1/4" ref={setPropertiesPanel}></div>
        </div>
    );
}
