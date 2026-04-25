import { Canvg } from 'canvg';
import download from 'downloadjs';
import type { CommandContext } from '../types';

export type ExportDiagramCommand = {
  type: 'export-diagram';
  diagramName: string;
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
    let iconDiv = foreignObject.querySelector('div[data-icon-class]');
    if (!iconDiv) iconDiv = foreignObject.querySelector('DIV[data-icon-class]');
    if (!iconDiv) continue;

    const iconClass = iconDiv.getAttribute('data-icon-class');
    if (!iconClass) continue;

    const color = iconDiv.getAttribute('data-icon-color')
      || foreignObject.getAttribute('color')
      || foreignObject.getAttribute('style')?.match(/color:\s*([^;]+)/)?.[1];

    const iconData = await fetchIconSvg(iconClass);
    if (!iconData) continue;

    const x = foreignObject.getAttribute('x');
    const y = foreignObject.getAttribute('y');
    const width = foreignObject.getAttribute('width');
    const height = foreignObject.getAttribute('height');

    let iconContent = iconData.content;
    if (color) {
      iconContent = iconContent.replace(/currentColor/g, color);
    }

    const iconSvg = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    iconSvg.setAttribute('x', x || '0');
    iconSvg.setAttribute('y', y || '0');
    iconSvg.setAttribute('width', width || '24');
    iconSvg.setAttribute('height', height || '24');
    iconSvg.setAttribute('viewBox', iconData.viewBox);
    iconSvg.setAttribute('stroke', 'none');
    iconSvg.innerHTML = iconContent;

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
  const context = canvas.getContext('2d');
  const canvg = Canvg.fromString(context as any, svg);
  await canvg.render();

  (context as any).globalCompositeOperation = 'destination-over';
  (context as any).fillStyle = 'white';
  (context as any).fillRect(0, 0, canvas.width, canvas.height);

  return canvas.toDataURL('image/png');
}

export async function runExportDiagram(
  context: CommandContext,
  command: ExportDiagramCommand,
): Promise<void> {
  if (!context.modeler) {
    throw new Error("Command 'export-diagram' requires a modeler instance.");
  }

  const { svg } = await context.modeler.saveSVG();
  const { xml } = await context.modeler.saveXML();

  let svgClean = svg.replace(/^(\s*<\?xml[^>]*>\s*)?(?:\s*<!--[\s\S]*?-->\s*)+/i, '$1');
  svgClean = await embedIconsInSvg(svgClean);
  svgClean = embedStudyflowIntoSvg(svgClean, xml);

  if (command.fileType === 'png') {
    const png = await exportToPng(svgClean);
    download(png, `${command.diagramName}.png`, 'image/png');
    return;
  }

  if (command.fileType === 'svg') {
    download(svgClean, `${command.diagramName}.svg`, 'image/svg+xml');
    return;
  }

  download(xml, `${command.diagramName}.studyflow`, 'application/xml');
}
