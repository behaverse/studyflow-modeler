import { useEffect, useContext } from "react";
import { ModelerContext, DiagramNameContext } from '../../contexts';
import PropTypes from 'prop-types';
import { executeCommand } from '../../commands';

export function ExportButton({ className, fileType, onClick, ...props }) {

  const { modeler } = useContext(ModelerContext);
  const { diagramName } = useContext(DiagramNameContext);

  useEffect(() => {
  }, [modeler]);

  async function exportDiagram(e) {
    await executeCommand(modeler, {
      type: 'export-diagram',
      diagramName,
      fileType: fileType.toLowerCase(),
    });

    if (onClick) onClick(e);
  }

  return (
    <button
      title="Export to SVG"
      className={`w-full text-left ${className}`}
      {...props}
      onClick={exportDiagram}>
      <i className={`bi bi-filetype-${fileType.toLowerCase()} pe-2`}></i> Export to {fileType.toUpperCase()}...
    </button>
  );

}

ExportButton.propTypes = {
  className: PropTypes.string,
  fileType: PropTypes.string.isRequired,
  onClick: PropTypes.func
};
