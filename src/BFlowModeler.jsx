import { useEffect, useState } from 'react';

import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import new_diagram from '/src/assets/new_diagram.bpmn';

function BFlowModeler() {

    const [container, setContainer] = useState(null);

    useEffect(() => {
        const modeler = new BpmnModeler({
            container: container,
        });

        fetch(new_diagram)
            .then(r => r.text())
            .then(content => {
                modeler.importXML(content);
            });
        modeler.get('canvas').zoom('fit-viewport');

        return () => {
            modeler.destroy();
        }
    }, [container]);

    return (
        <div
            className="diagram-container"
            ref={setContainer}
            style={{
                border: "2px solid purple",
                height: "90vh",
                width: "90vw"
              }}></div>
    );
}

export default BFlowModeler;