import { useEffect, useContext } from "react";
import {ModelerContext} from '../Contexts';
import download from 'downloadjs';

export default function DownloadButton() {

  const modeler = useContext(ModelerContext);

  useEffect(() => {
  }, [modeler]);

  function downloadDiagram() {
    modeler.saveXML({ format: true }).then(({ xml }) => {
      download(xml, 'diagram.bpmn', 'application/xml');
    });
  }

  return (
      <button
        title="Download"
        className="bg-gray-200 hover:bg-gray-300 border-y border-s border-gray-300  text-black py-1 px-3 rounded-s"
        onClick={downloadDiagram}>
          <i className="bi bi-download w-3 h-3"></i>
        </button>
  );

}
