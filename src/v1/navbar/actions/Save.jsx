import { useContext } from "react";
import {DiagramNameContext, ModelerContext} from '../../contexts';
import download from 'downloadjs';
import PropTypes from 'prop-types';

export function SaveButton({ className, onClick, ...props }) {

  const { modeler } = useContext(ModelerContext);
  const { diagramName } = useContext(DiagramNameContext);

  function downloadDiagram(e) {
    modeler.saveXML({ format: true }).then(({ xml }) => {
      download(xml, diagramName + '.studyflow', 'application/xml');
    });
    if (onClick) onClick(e);
  }

  return (
      <button
        title="Download"
        className={`w-full text-left ${className}`}
        {...props}
        onClick={downloadDiagram}>
          <i className="bi bi-download pe-2"></i> Save As...
        </button>
  );

}

SaveButton.propTypes = {
  className: PropTypes.string,
  onClick: PropTypes.func
};
