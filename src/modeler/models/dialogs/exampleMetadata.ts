import { looksLikeXml, readStudyflowMetadata } from '@/core/codec';
import { filenameStem } from '@/modeler/models/diagramFile';

/** Namespace URIs the XML metadata reader looks under. Supplied by the caller
 *  so this module stays free of modeler-infra constants. */
export type MetadataNamespaces = { bpmn: string; core: string };

export function humanizeId(id: string): string {
  return id.replace(/[_-]+/g, ' ').trim();
}

export function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

export function parseXmlExampleMetadata(
  text: string,
  ns: MetadataNamespaces,
): { name?: string; id?: string; description?: string } {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid XML');

  const process = doc.getElementsByTagNameNS(ns.bpmn, 'process')[0]
    ?? doc.getElementsByTagNameNS(ns.core, 'study')[0];
  if (!process) return {};

  return {
    name: process.getAttribute('name')?.trim() || undefined,
    id: process.getAttribute('id') ?? undefined,
    description: Array.from(process.children).find(
      (c) => c.namespaceURI === ns.bpmn && c.localName === 'documentation'
        && c.getAttributeNS(ns.core, 'checklist') !== 'true',
    )?.textContent?.trim() || undefined,
  };
}

/** Examples ship as YAML `.studyflow`; `.bpmn`/`.svg` (and legacy files) are XML. */
export function parseExampleMetadata(
  filename: string,
  text: string,
  ns: MetadataNamespaces,
): { title: string; description: string } {
  const meta = looksLikeXml(text) ? parseXmlExampleMetadata(text, ns) : readStudyflowMetadata(text);
  const title = meta.name
    || (meta.id ? humanizeId(meta.id) : '')
    || filenameStem(filename);
  return { title, description: meta.description ?? '' };
}
