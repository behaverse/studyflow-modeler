import { Canvg } from 'canvg';
import download from 'downloadjs';
import { getDiagramName } from '../../diagramName';

export type ExportDiagramCommand = {
  type: 'export-diagram';
  fileType: 'svg' | 'png' | 'studyflow';
};

async function fetchIconSvg(iconClass: string) {
  const parts = iconClass.split(' ');
  const iconPart = parts.find((p: string) => p.includes('--'));
  if (!iconPart) return null;

  const [collection, iconName] = iconPart.split('--');
  const response = await fetch(`https://api.iconify.design/${collection}/${iconName}.svg`);
  if (!response.ok) return null;

  const svgText = await response.text();
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
  const svgElement = svgDoc.querySelector('svg');
  if (!svgElement) return null;

  return {
    content: svgElement.innerHTML,
    viewBox: svgElement.getAttribute('viewBox') || '0 0 24 24',
  };
}

async function embedIconsInSvg(svgString: string): Promise<string> {
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svgString, 'image/svg+xml');
  const foreignObjects = svgDoc.querySelectorAll('foreignObject.icon-container');

  for (const foreignObject of foreignObjects) {
    const iconDiv = foreignObject.querySelector('div[data-icon-class], DIV[data-icon-class]');
    const iconClass = iconDiv?.getAttribute('data-icon-class');
    if (!iconClass) continue;

    const iconData = await fetchIconSvg(iconClass);
    if (!iconData) continue;

    const color = iconDiv?.getAttribute('data-icon-color')
      || foreignObject.getAttribute('color')
      || foreignObject.getAttribute('style')?.match(/color:\s*([^;]+)/)?.[1];

    const iconSvg = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    iconSvg.setAttribute('x', foreignObject.getAttribute('x') || '0');
    iconSvg.setAttribute('y', foreignObject.getAttribute('y') || '0');
    iconSvg.setAttribute('width', foreignObject.getAttribute('width') || '24');
    iconSvg.setAttribute('height', foreignObject.getAttribute('height') || '24');
    iconSvg.setAttribute('viewBox', iconData.viewBox);
    iconSvg.setAttribute('stroke', 'none');
    iconSvg.innerHTML = color ? iconData.content.replace(/currentColor/g, color) : iconData.content;

    foreignObject.parentNode?.replaceChild(iconSvg, foreignObject);
  }

  return new XMLSerializer().serializeToString(svgDoc);
}

function embedStudyflowIntoSvg(svg: string, xml: string): string {
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svg, 'image/svg+xml');
  const svgEl = svgDoc.querySelector('svg') || svgDoc.documentElement;

  const xmlClean = xml
    .replace(/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[\s\S]*?>\s*)?/i, '')
    .trim();

  const metadataEl = svgDoc.createElement('metadata');
  svgEl.insertBefore(metadataEl, svgEl.firstElementChild);

  const studyflowEl = svgDoc.createElement('studyflow');
  metadataEl.appendChild(studyflowEl);
  studyflowEl.innerHTML = xmlClean;

  return new XMLSerializer().serializeToString(svgDoc);
}

async function exportToPng(svg: string): Promise<string> {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  const canvg = Canvg.fromString(context, svg);
  await canvg.render();

  // White background under the rendered SVG so transparent areas don't appear black.
  context.globalCompositeOperation = 'destination-over';
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);

  return canvas.toDataURL('image/png');
}

export async function runExportDiagram(modeler: any, command: ExportDiagramCommand): Promise<void> {
  const filename = getDiagramName(modeler) ?? 'diagram';

  if (command.fileType === 'studyflow') {
    const { xml } = await modeler.saveXML();
    download(xml, `${filename}.studyflow`, 'application/xml');
    return;
  }

  const [{ svg }, { xml }] = await Promise.all([modeler.saveSVG(), modeler.saveXML()]);
  let svgClean = svg.replace(/^(\s*<\?xml[^>]*>\s*)?(?:\s*<!--[\s\S]*?-->\s*)+/i, '$1');
  svgClean = await embedIconsInSvg(svgClean);
  svgClean = embedStudyflowIntoSvg(svgClean, xml);

  if (command.fileType === 'png') {
    const png = await exportToPng(svgClean);
    download(png, `${filename}.png`, 'image/png');
  } else {
    download(svgClean, `${filename}.svg`, 'image/svg+xml');
  }
}
