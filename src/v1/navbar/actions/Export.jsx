import { Canvg } from 'canvg';

import { useEffect, useContext } from "react";
import { ModelerContext, DiagramNameContext } from '../../contexts';
import download from 'downloadjs';
import PropTypes from 'prop-types';

async function fetchIconSvg(iconClass) {
  // Parse iconClass format: "iconify collection--icon-name"
  const parts = iconClass.split(' ');
  const iconPart = parts.find(p => p.includes('--'));
  if (!iconPart) return null;

  const [collection, iconName] = iconPart.split('--');

  try {
    // Fetch from Iconify API
    const response = await fetch(`https://api.iconify.design/${collection}/${iconName}.svg`);
    if (!response.ok) return null;

    const svgText = await response.text();

    // Parse the SVG to extract its content
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
    const svgElement = svgDoc.querySelector('svg');

    if (!svgElement) return null;

    return {
      content: svgElement.innerHTML,
      viewBox: svgElement.getAttribute('viewBox') || '0 0 24 24'
    };
  } catch (error) {
    console.error('Failed to fetch icon:', iconClass, error);
    return null;
  }
}

async function embedIconsInSvg(svgString) {
  // Parse the SVG string
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svgString, 'image/svg+xml');

  // Find all foreignObject elements with icon containers
  const foreignObjects = svgDoc.querySelectorAll('foreignObject.icon-container');

  console.log('Found foreignObjects:', foreignObjects.length);

  // Process each icon
  for (const foreignObject of foreignObjects) {
    // Find the div with icon data inside the foreignObject (check both lowercase and uppercase)
    let iconDiv = foreignObject.querySelector('div[data-icon-class]');
    if (!iconDiv) {
      iconDiv = foreignObject.querySelector('DIV[data-icon-class]');
    }

    if (!iconDiv) {
      console.log('No icon div found in foreignObject');
      continue;
    }

    const iconClass = iconDiv.getAttribute('data-icon-class');
    const color = iconDiv.getAttribute('data-icon-color') || foreignObject.getAttribute('color') || foreignObject.getAttribute('style')?.match(/color:\s*([^;]+)/)?.[1];

    console.log('Processing icon:', iconClass, 'color:', color);

    const iconData = await fetchIconSvg(iconClass);

    if (!iconData) {
      console.log('Failed to fetch icon data for:', iconClass);
      continue;
    }

    // Get the foreignObject position and size
    const x = foreignObject.getAttribute('x');
    const y = foreignObject.getAttribute('y');
    const width = foreignObject.getAttribute('width');
    const height = foreignObject.getAttribute('height');

    // Replace currentColor with the actual color in the icon content
    let iconContent = iconData.content;
    if (color) {
      iconContent = iconContent.replace(/currentColor/g, color);
    }

    // Create a new SVG element with the icon embedded
    const iconSvg = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    iconSvg.setAttribute('x', x);
    iconSvg.setAttribute('y', y);
    iconSvg.setAttribute('width', width);
    iconSvg.setAttribute('height', height);
    iconSvg.setAttribute('viewBox', iconData.viewBox);
    iconSvg.setAttribute('stroke', 'none');
    iconSvg.innerHTML = iconContent;

    console.log('Replacing foreignObject with embedded SVG');

    // Replace the foreignObject with the embedded SVG
    foreignObject.parentNode.replaceChild(iconSvg, foreignObject);
  }

  // Serialize back to string
  const serializer = new XMLSerializer();
  return serializer.serializeToString(svgDoc);
}

function embedStudyflowIntoSvg(svg, xml) {
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svg, 'image/svg+xml');
  const svgEl = svgDoc.querySelector('svg') || svgDoc.documentElement;

  // clean xml
  const xmlClean = xml.replace(/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[\s\S]*?>\s*)?/i, '').trim();

  let metadataEl = svgDoc.createElement('metadata');
  svgEl.insertBefore(metadataEl, svgEl.firstElementChild);

  let studyflowEl = svgDoc.createElement('studyflow');
  metadataEl.appendChild(studyflowEl);

  studyflowEl.innerHTML = xmlClean;

  return new XMLSerializer().serializeToString(svgDoc);
}

async function exportToPng(svg) {

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

export function ExportButton({ className, fileType, onClick, ...props }) {

  const { modeler } = useContext(ModelerContext);
  const { diagramName } = useContext(DiagramNameContext);

  useEffect(() => {
  }, [modeler]);

  async function exportDiagram(e) {
    const { svg } = await modeler.saveSVG();
    const { xml } = await modeler.saveXML();

    let svgClean = svg.replace(/^(\s*<\?xml[^>]*>\s*)?(?:\s*<!--[\s\S]*?-->\s*)+/i, '$1');
    svgClean = await embedIconsInSvg(svgClean);
    svgClean = embedStudyflowIntoSvg(svgClean, xml);

    if (fileType === 'png') {
      const png = await exportToPng(svgClean);
      download(png, diagramName + '.png', 'image/png');
    } else if (fileType === 'svg') {
      download(svgClean, diagramName + '.svg', 'image/svg+xml');
    } else if (fileType === 'studyflow') {
      download(xml, diagramName + '.studyflow', 'application/xml');
    }

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
