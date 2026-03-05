import { useContext } from "react";
import {DiagramNameContext, ModelerContext} from '../../contexts';
import PropTypes from 'prop-types';
import { executeCommand } from '../../commands';

export function SaveButton({ className, onClick, ...props }) {

  const { modeler } = useContext(ModelerContext);
  const { diagramName } = useContext(DiagramNameContext);

  function downloadDiagram(e) {
    executeCommand(modeler, {
      type: 'save-diagram',
      diagramName,
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
