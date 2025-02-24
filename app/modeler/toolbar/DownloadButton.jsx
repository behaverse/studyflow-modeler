import { useEffect, useContext } from "react";
import {ModelerContext} from '../contexts';
import download from 'downloadjs';

export default function DownloadButton() {

  const {modeler} = useContext(ModelerContext);

  useEffect(() => {
  }, [modeler]);

  function downloadDiagram() {
    modeler.saveXML({ format: true }).then(({ xml }) => {
      download(xml, 'StudyFlow Diagram.bpmn', 'application/xml');
    });
  }

  return (
      <button
        title="Download"
        className="shadow-sm bg-stone-200 hover:bg-stone-300 border border-stone-300 text-black py-1 px-3"
        onClick={downloadDiagram}>
          <i className="bi bi-cloud-download"></i>
        </button>
  );

}
