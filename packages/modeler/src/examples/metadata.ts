import { CHECKLIST_MARKER, isChecklistMarkerValue } from '@core/document';
import { firstSentence } from '@core/naming';
import { namespaces } from '@core/notation';
import { filenameStem } from '@modeler/diagram/file';
import { extractXmlFromPng } from '@core/document/png';

/** Namespace URIs the XML metadata reader looks under. */
type MetadataNamespaces = { bpmn: string; core: string };

function studyflowAttribute(el: Element, ns: MetadataNamespaces, name: string): string | null {
  return el.getAttributeNS(ns.core, name);
}

export type ExampleMetadata = {
  title: string;
  summary: string;
};

const ROOT_TYPES = ['process', 'collaboration', 'choreography'];

function humanizeId(id: string): string {
  return id.replace(/[_-]+/g, ' ').trim();
}

export function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

function planeRootId(doc: Document): string | undefined {
  const plane = doc.getElementsByTagNameNS('*', 'BPMNPlane')[0];
  return plane?.getAttribute('bpmnElement') ?? undefined;
}

function rootsOf(doc: Document, ns: MetadataNamespaces): Element[] {
  const roots = [
    ...ROOT_TYPES.flatMap((type) => [...doc.getElementsByTagNameNS(ns.bpmn, type)]),
    ...doc.getElementsByTagNameNS(ns.core, 'study'),
  ]
    // A sub-process is a `bpmn:process` in name only when it is not a root.
    .filter((el) => el.parentElement?.localName === 'definitions');

  const drawn = planeRootId(doc);
  const primary = drawn ? roots.filter((el) => el.getAttribute('id') === drawn) : [];
  return [...primary, ...roots.filter((el) => !primary.includes(el))];
}

function parseXmlExampleMetadata(
  xml: string,
  ns: MetadataNamespaces,
): { name?: string; id?: string; description?: string } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid XML');

  const roots = rootsOf(doc, ns);
  if (roots.length === 0) return {};

  // A card is built field by field: the drawn root leads, but a field it lacks is read from the next root carrying it (a pool splits name and documentation across roots).
  const firstOf = <T>(read: (root: Element) => T | undefined): T | undefined =>
    roots.map(read).find((value) => value !== undefined);

  return {
    name: firstOf((root) => root.getAttribute('name')?.trim() || undefined),
    id: firstOf((root) => root.getAttribute('id') ?? undefined),
    description: firstOf((root) => Array.from(root.children).find(
      (c) => c.namespaceURI === ns.bpmn && c.localName === 'documentation'
        && !isChecklistMarkerValue(studyflowAttribute(c, ns, CHECKLIST_MARKER)),
    )?.textContent?.trim() || undefined),
  };
}

export function readExampleMetadata(filename: string, png: ArrayBuffer): ExampleMetadata {
  const meta = parseXmlExampleMetadata(extractXmlFromPng(png), namespaces());
  return {
    title: meta.name || (meta.id ? humanizeId(meta.id) : '') || filenameStem(filename),
    summary: firstSentence(meta.description ?? ''),
  };
}
