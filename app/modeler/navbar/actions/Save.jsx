import { useState, useEffect, useContext } from "react";
import {ModelerContext} from '../../contexts';
import download from 'downloadjs';

export function SaveButton({ className, ...props }) {

  const { modeler } = useContext(ModelerContext);
  const [diagramId, setDiagramId] = useState('Diagram');

  useEffect(() => {
    if (modeler  && modeler._definitions) {
      setDiagramId(modeler._definitions.id);
    }
  }, [modeler]);

  function downloadDiagram() {
    modeler.saveXML({ format: true }).then(({ xml }) => {
      download(xml, diagramId + '.studyflow', 'application/xml');
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
