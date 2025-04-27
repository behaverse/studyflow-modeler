import { Canvg } from 'canvg';

import { useEffect, useContext } from "react";
import { ModelerContext } from '../../contexts';
import download from 'downloadjs';
import PropTypes from 'prop-types';

async function exportoToPng(svg) {

  let canvas = document.createElement('canvas');

  const context = canvas.getContext('2d');

  const canvg = Canvg.fromString(context, svg);
  await canvg.render();

  context.globalCompositeOperation = 'destination-over';
  context.fillStyle = 'white';

  context.fillRect(0, 0, canvas.width, canvas.height);

  const dataURL = canvas.toDataURL('image/png');
  return dataURL;

}

export function ExportButton({ className, fileType, ...props }) {

  const { modeler } = useContext(ModelerContext);
  const fileTypeIcon = {
    png: 'bi bi-file-png',
    svg: 'bi bi-file-svg',
  }[fileType];

  useEffect(() => {
  }, [modeler]);

  function exportDiagram() {
    modeler.saveSVG().then(({ svg }) => {
      if (fileType === 'png') {
        exportoToPng(svg).then((dataURL) => {
          download(dataURL, 'diagram.png', 'image/png');
        });
      } else if (fileType === 'svg') {
        download(svg, 'diagram.svg', 'image/svg+xml');
      }
    });
  }

  return (
    <button
      title="Export to SVG"
      className={`w-full text-left ${className}`}
      onClick={exportDiagram}>
      <i className={`bi bi-filetype-${fileType.toLowerCase()} pe-2`}></i> Export to {fileType.toUpperCase()}...
    </button>
  );

}

ExportButton.propTypes = {
  className: PropTypes.string,
  fileType: PropTypes.string.isRequired
};
