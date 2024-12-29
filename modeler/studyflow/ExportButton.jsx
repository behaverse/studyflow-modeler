import { useEffect, useContext } from "react";
import {StudyFlowContext} from '../StudyFlowContext';

import download from 'downloadjs';

export default function ExportButton() {

  const modeler = useContext(StudyFlowContext);

  useEffect(() => {
    // print all  the injected dependencies to the console
    console.log('modeler:', modeler);
  }, [modeler]);

  function downloadDiagram() {
    modeler.saveXML({ format: true }).then(({ xml }) => {
      download(xml, 'diagram.bpmn', 'application/xml');
    });
  }

  return (
    <div className="fixed bottom-4 left-4">
      <button
        className="bg-fuchsia-700 hover:bg-fuchsia-900 text-white font-bold py-2 px-4 rounded"
        onClick={downloadDiagram}>Export</button>
    </div>
  );

}
