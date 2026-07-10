import download from 'downloadjs';
import { xmlToStudyflow } from '@/core/codec';
import { toWireXml } from '@/core/codec/choreography';
import { getDiagramName } from '@/modeler/models/diagramName';
import { exportToLinkML } from '@/modeler/models/exporters/linkml';
import { exportToNidm } from '@/modeler/models/exporters/nidm';
import { exportToArtemis } from '@/modeler/models/exporters/artemis';
import { embedIconsInSvg, embedStudyflowIntoSvg, exportToPng } from '@/modeler/models/exporters/svgEmbedding';
import { remoteIconSource } from '@/modeler/infra/iconSource';

/** All the formats under `Save As...`; `studyflow` (YAML) is the native one. */
export type SaveFileType = 'studyflow' | 'bpmn' | 'svg' | 'png' | 'linkml' | 'nidm' | 'artemis';

export type SaveDiagramCommand = {
  type: 'save-diagram';
  fileType?: SaveFileType;
};

export async function runSaveDiagram(modeler: any, command: SaveDiagramCommand): Promise<void> {
  const fileType = command.fileType ?? 'studyflow';
  const filename = getDiagramName(modeler) ?? 'diagram';

  // Native `.studyflow` files are YAML (see `core/studyflowYaml`).
  // Pure-choreography diagrams leave the app as a spec-clean bpmn:Choreography
  // root (see `core/codec/choreography`); `toWireXml` is a no-op otherwise.
  if (fileType === 'studyflow') {
    const { xml } = await modeler.saveXML({ format: true });
    const wireXml = await toWireXml(xml, modeler.get('moddle'));
    const yamlText = await xmlToStudyflow(wireXml, modeler.get('moddle'));
    download(yamlText, `${filename}.studyflow`, 'text/yaml');
    return;
  }

  // Raw BPMN 2.0 XML, for interop with other BPMN tooling.
  if (fileType === 'bpmn') {
    const { xml } = await modeler.saveXML({ format: true });
    const wireXml = await toWireXml(xml, modeler.get('moddle'));
    download(new Blob([wireXml], { type: 'application/xml;charset=utf-8' }), `${filename}.bpmn`, 'application/xml');
    return;
  }

  if (fileType === 'linkml') {
    const linkmlYaml = exportToLinkML(modeler);
    download(new Blob([linkmlYaml], { type: 'text/yaml;charset=utf-8' }), `${filename}.linkml.yaml`, 'text/yaml');
    return;
  }

  if (fileType === 'nidm') {
    const turtle = exportToNidm(modeler);
    download(new Blob([turtle], { type: 'text/turtle;charset=utf-8' }), `${filename}.nidm.ttl`, 'text/turtle');
    return;
  }

  if (fileType === 'artemis') {
    const json = exportToArtemis(modeler);
    download(new Blob([json], { type: 'application/json;charset=utf-8' }), `${filename}.artemis.json`, 'application/json');
    return;
  }

  const [{ svg }, { xml }] = await Promise.all([modeler.saveSVG(), modeler.saveXML()]);
  const wireXml = await toWireXml(xml, modeler.get('moddle'));
  let svgClean = svg.replace(/^(\s*<\?xml[^>]*>\s*)?(?:\s*<!--[\s\S]*?-->\s*)+/i, '$1');
  svgClean = await embedIconsInSvg(svgClean, remoteIconSource);
  svgClean = embedStudyflowIntoSvg(svgClean, wireXml);

  if (fileType === 'png') {
    const png = await exportToPng(svgClean);
    download(png, `${filename}.png`, 'image/png');
  } else {
    download(new Blob([svgClean], { type: 'image/svg+xml;charset=utf-8' }), `${filename}.svg`, 'image/svg+xml');
  }
}
