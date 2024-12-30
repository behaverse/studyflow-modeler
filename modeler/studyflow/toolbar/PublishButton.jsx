import { useEffect, useContext } from "react";

import {ModelerContext} from '../ModelerContext';

export default function ExportButton() {

  const modeler = useContext(ModelerContext);

  useEffect(() => {
  }, [modeler]);

  function publishDiagram() {
    modeler.saveXML({ format: true }).then(({ xml }) => {
        console.log(xml);
        alert('Diagram published successfully');
    });
  }

  return (
      <button
        title="Publish"
        className="bg-gray-200 hover:bg-gray-300 border border-gray-300 text-black py-1 px-3 rounded-e"
        onClick={publishDiagram}>
          <i className="bi bi-broadcast-pin w-3 h-3"></i>
      </button>
  );

}
