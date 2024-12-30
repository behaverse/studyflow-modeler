import { useEffect, useContext } from "react";

import {ModelerContext} from '../ModelerContext';

export default function ExportButton() {

  const modeler = useContext(ModelerContext);

  useEffect(() => {
    console.log('modeler:', modeler);
  }, [modeler]);

  function publishDiagram() {
    modeler.saveXML({ format: true }).then(({ xml }) => {
        console.log(xml);
        alert('Diagram published successfully');
    });
  }

  return (
      <button
        className="bg-fuchsia-700 hover:bg-fuchsia-900 text-sm font-small text-white py-1 px-4 rounded-e"
        onClick={publishDiagram}>
          <i className="bi bi-broadcast-pin w-3 h-3 me-2"></i>
          Publish</button>
  );

}
