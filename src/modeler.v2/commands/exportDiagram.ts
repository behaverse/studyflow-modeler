import download from 'downloadjs';
import { useModelerStore } from '../store';

/**
 * Export the current diagram as .studyflow (XML), .svg, or .png.
 *
 * For SVG export, we generate SVG from the React Flow viewport,
 * embed the BPMN XML into SVG metadata.
 * For .studyflow, we just serialize the moddle model.
 */

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

function generateSvgFromNodes(): string {
  const { nodes, edges } = useModelerStore.getState();

  // Calculate bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of nodes) {
    const w = (node.data?.width as number) || 100;
    const h = (node.data?.height as number) || 80;
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + w);
    maxY = Math.max(maxY, node.position.y + h);
  }

  const padding = 40;
  minX -= padding; minY -= padding;
  maxX += padding; maxY += padding;
  const width = maxX - minX;
  const height = maxY - minY;

  let svgContent = '';

  // Draw edges as lines
  for (const edge of edges) {
    const sourceNode = nodes.find((n) => n.id === edge.source);
    const targetNode = nodes.find((n) => n.id === edge.target);
    if (!sourceNode || !targetNode) continue;

    const sw = (sourceNode.data?.width as number) || 100;
    const sh = (sourceNode.data?.height as number) || 80;
    const tw = (targetNode.data?.width as number) || 100;
    const th = (targetNode.data?.height as number) || 80;

    const x1 = sourceNode.position.x + sw / 2 - minX;
    const y1 = sourceNode.position.y + sh / 2 - minY;
    const x2 = targetNode.position.x + tw / 2 - minX;
    const y2 = targetNode.position.y + th / 2 - minY;

    svgContent += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#57534e" stroke-width="1.5" marker-end="url(#arrow)"/>\n`;
  }

  // Draw nodes as shapes
  for (const node of nodes) {
    const x = node.position.x - minX;
    const y = node.position.y - minY;
    const w = (node.data?.width as number) || 100;
    const h = (node.data?.height as number) || 80;
    const label = (node.data?.label as string) || '';
    const bpmnType = (node.data?.bpmnType as string) || '';

    if (bpmnType.includes('Event')) {
      const cx = x + w / 2;
      const cy = y + h / 2;
      const r = w / 2;
      const strokeW = bpmnType === 'bpmn:EndEvent' ? 3 : 2;
      svgContent += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="white" stroke="#292524" stroke-width="${strokeW}"/>\n`;
    } else if (bpmnType.includes('Gateway')) {
      const cx = x + w / 2;
      const cy = y + h / 2;
      const hw = w / 2;
      svgContent += `<polygon points="${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}" fill="white" stroke="#292524" stroke-width="2"/>\n`;
    } else if (bpmnType === 'bpmn:Group') {
      svgContent += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#a8a29e" stroke-width="2" stroke-dasharray="8 4" rx="8"/>\n`;
    } else {
      svgContent += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="white" stroke="#292524" stroke-width="2" rx="8"/>\n`;
    }

    if (label) {
      const tx = x + w / 2;
      const ty = y + h / 2 + 4;
      svgContent += `<text x="${tx}" y="${ty}" text-anchor="middle" font-size="12" font-family="IBM Plex Sans, Helvetica, sans-serif" fill="#292524">${escapeXml(label)}</text>\n`;
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#57534e"/>
    </marker>
  </defs>
  ${svgContent}
</svg>`;
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function exportDiagram(
  diagramName: string,
  fileType: 'svg' | 'png' | 'studyflow',
): Promise<void> {
  const store = useModelerStore.getState();
  const xml = await store.exportXml();

  if (fileType === 'studyflow') {
    download(xml, `${diagramName}.studyflow`, 'application/xml');
    return;
  }

  let svg = generateSvgFromNodes();
  svg = embedStudyflowIntoSvg(svg, xml);

  if (fileType === 'svg') {
    download(svg, `${diagramName}.svg`, 'image/svg+xml');
    return;
  }

  // PNG export via canvas
  const { Canvg } = await import('canvg');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  const canvg = Canvg.fromString(context as any, svg);
  await canvg.render();

  context.globalCompositeOperation = 'destination-over';
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const png = canvas.toDataURL('image/png');
  download(png, `${diagramName}.png`, 'image/png');
}
