import { firstSentence } from '@/core/naming';
import { filenameStem } from '@/modeler/models/diagramFile';
import { extractXmlFromPng } from '@/modeler/models/exporters/pngEmbedding';

export { firstSentence };

/**
 * What a gallery card says about a diagram, read from the diagram.
 *
 * Examples ship as PNGs with their studyflow inside them, so the picture and
 * the source are one file — and its title, blurb, and tags are properties of
 * the root element, not entries in a manifest kept beside it.
 * Nothing here knows the examples: a diagram a user saves carries the same
 * three things.
 */

/** Namespace URIs the XML metadata reader looks under. Supplied by the caller
 *  so this module stays free of modeler-infra constants. */
export type MetadataNamespaces = { bpmn: string; core: string };

function studyflowAttribute(el: Element, ns: MetadataNamespaces, name: string): string | null {
  return el.getAttributeNS(ns.core, name);
}

export type ExampleMetadata = {
  title: string;
  /** One sentence, from the root's `documentation`. */
  summary: string;
  /** The root's `studyflow:tags`; empty when the diagram declares none. */
  tags: string[];
};

/** Roots a diagram can have, when nothing better says which one it is. */
const ROOT_TYPES = ['process', 'collaboration', 'choreography'];

export function humanizeId(id: string): string {
  return id.replace(/[_-]+/g, ' ').trim();
}

export function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

/**
 * Id of the element the diagram's first plane draws — which root *is* the
 * diagram, as far as the canvas is concerned. Prefix-agnostic on the DI
 * namespace, like `hasDiagramInterchange`.
 */
function planeRootId(doc: Document): string | undefined {
  const plane = doc.getElementsByTagNameNS('*', 'BPMNPlane')[0];
  return plane?.getAttribute('bpmnElement') ?? undefined;
}

/**
 * Root elements of a `bpmn:Definitions`, the diagram's own first.
 *
 * A collaboration and the process it wraps are both roots, and they can carry
 * different answers to the same question: the modeler reads and writes
 * whichever one the canvas shows (`canvas.getRootElement()` — the collaboration
 * for a pool diagram), so a card built from the other one shows a title or a
 * shelf that no longer matches what the file says. The plane names the root the
 * canvas shows, so ask it first and fall back to the type order only for a
 * hand-written file that ships no DI.
 */
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

/** The tags one root declares, as `<studyflow:tags>` children. */
function tagsOf(root: Element, ns: MetadataNamespaces): string[] {
  return Array.from(root.children)
    .filter((child) => child.namespaceURI === ns.core && child.localName === 'tags')
    .map((child) => child.textContent?.trim() ?? '')
    .filter(Boolean);
}

export function parseXmlExampleMetadata(
  xml: string,
  ns: MetadataNamespaces,
): { name?: string; id?: string; description?: string; tags: string[] } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid XML');

  const roots = rootsOf(doc, ns);
  if (roots.length === 0) return { tags: [] };

  /**
   * A card is built field by field, not from one root: the drawn root leads
   * (see `rootsOf`), so it wins whenever two roots answer the same question
   * differently, but a field it does not carry is read from the next root that
   * does. A pool diagram splits them exactly this way — the collaboration is
   * named and shelved, the process it wraps is documented — so asking a single
   * root for everything drops half the card.
   */
  const firstOf = <T>(read: (root: Element) => T | undefined): T | undefined =>
    roots.map(read).find((value) => value !== undefined);

  return {
    name: firstOf((root) => root.getAttribute('name')?.trim() || undefined),
    id: firstOf((root) => root.getAttribute('id') ?? undefined),
    description: firstOf((root) => Array.from(root.children).find(
      (c) => c.namespaceURI === ns.bpmn && c.localName === 'documentation'
        && studyflowAttribute(c, ns, 'checklist') !== 'true',
    )?.textContent?.trim() || undefined),
    tags: firstOf((root) => {
      const declared = tagsOf(root, ns);
      return declared.length > 0 ? declared : undefined;
    }) ?? [],
  };
}

/** Title, blurb, and tags of an example, read out of its embedded diagram. */
export function readExampleMetadata(
  filename: string,
  png: ArrayBuffer,
  ns: MetadataNamespaces,
): ExampleMetadata {
  const meta = parseXmlExampleMetadata(extractXmlFromPng(png), ns);
  return {
    title: meta.name || (meta.id ? humanizeId(meta.id) : '') || filenameStem(filename),
    summary: firstSentence(meta.description ?? ''),
    tags: meta.tags,
  };
}
