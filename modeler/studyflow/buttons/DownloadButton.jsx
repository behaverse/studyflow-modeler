import { useEffect, useContext } from "react";
import {ModelerContext} from '../ModelerContext';
import download from 'downloadjs';

export default function DownloadButton() {

  const modeler = useContext(ModelerContext);

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
      <button
        className="bg-fuchsia-700 hover:bg-fuchsia-900 text-sm font-small text-white py-1 px-4"
        onClick={downloadDiagram}>
          <i className="bi bi-download w-3 h-3 me-2"></i>
          Download
        </button>
  );

}
