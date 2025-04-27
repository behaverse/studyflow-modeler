import { useEffect, useContext } from "react";
import {ModelerContext} from '../../contexts';
import download from 'downloadjs';

export function SaveButton({ className, ...props }) {

  const {modeler} = useContext(ModelerContext);

  useEffect(() => {
  }, [modeler]);

  function downloadDiagram() {
    modeler.saveXML({ format: true }).then(({ xml }) => {
      download(xml, 'Diagram.studyflow', 'application/xml');
    });
  }

  return (
      <button
        title="Download"
        className={`w-full text-left ${className}`}
        onClick={downloadDiagram}>
          <i className="bi bi-download pe-2"></i> Save As...
        </button>
  );

}
