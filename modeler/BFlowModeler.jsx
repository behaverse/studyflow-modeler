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
import TokenSimulationModule from 'bpmn-js-token-simulation';
import 'bpmn-js-token-simulation/assets/css/bpmn-js-token-simulation.css';
import new_diagram from './assets/new_diagram.bpmn';
import BFlowExtension from './assets/bflow';
import BFlowModule from './bflow';
import {
    CreateAppendAnythingModule,
    CreateAppendElementTemplatesModule
  } from 'bpmn-js-create-append-anything';
import {
  CloudElementTemplatesPropertiesProviderModule
} from 'bpmn-js-element-templates';

import elementTemplates from './assets/bflow_templates';
import BFlowPaletteProvider from './bflow/PaletteProvider';

function BFlowModeler() {

    const [canvas, setCanvas] = useState(null);
    const [propertiesPanel, setPropertiesPanel] = useState(null);

    useEffect(() => {
        const modeler = new BpmnModeler({
            container: canvas,
            propertiesPanel: {
                parent: propertiesPanel,
            },
            moddleExtensions: {
                bflow: BFlowExtension,
            },
            additionalModules: [
                TokenSimulationModule,
                BpmnPropertiesPanelModule,
                BpmnPropertiesProviderModule,
                BFlowModule,
                BFlowPaletteProvider,
                CloudElementTemplatesPropertiesProviderModule,
                CreateAppendAnythingModule,
                CreateAppendElementTemplatesModule,

            ],
            elementTemplates,
        });

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
                        console.error(err);
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
                border: "2px solid purple",
              }}></div>
            <div className="basis-1/4" ref={setPropertiesPanel}></div>
        </div>
    );
}

export default BFlowModeler;