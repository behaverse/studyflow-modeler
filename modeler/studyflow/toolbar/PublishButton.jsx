import { useEffect, useContext } from "react";

import {ModelerContext} from '../ModelerContext';

import xml2js from 'xml2js';

export default function ExportButton() {

  const modeler = useContext(ModelerContext);

  useEffect(() => {
  }, [modeler]);

  function publishDiagram() {
    modeler.saveXML({ format: true }).then(({ xml }) => {
      var parseString = xml2js.parseString;
      parseString(xml, function (err, result) {
        console.log(result);
      });
      alert('Diagram published!');
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
