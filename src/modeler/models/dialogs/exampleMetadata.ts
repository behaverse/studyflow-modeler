import { firstSentence } from '@/core/naming';
import { filenameStem } from '@/modeler/models/diagramFile';
import { extractXmlFromPng } from '@/modeler/models/exporters/pngEmbedding';

export { firstSentence };

/**
 * What a gallery card says about a diagram, read from the diagram.
 *
 * Examples ship as PNGs with their studyflow inside them, so the picture and
 * the source are one file — and its title, blurb, and categories are
 * properties of the root element, not entries in a manifest kept beside it.
 * Nothing here knows the examples: a diagram a user saves carries the same
 * three things.
 */

/** Namespace URIs the XML metadata reader looks under. Supplied by the caller
 *  so this module stays free of modeler-infra constants. `legacyCore` is the
 *  unversioned studyflow URI older files declare. */
export type MetadataNamespaces = { bpmn: string; core: string; legacyCore?: string };

/** A studyflow-namespaced attribute, under either spelling of the namespace. */
function studyflowAttribute(el: Element, ns: MetadataNamespaces, name: string): string | null {
  return el.getAttributeNS(ns.core, name)
    ?? (ns.legacyCore ? el.getAttributeNS(ns.legacyCore, name) : null);
}

export type ExampleMetadata = {
  title: string;
  /** One sentence, from the root's `documentation`. */
  summary: string;
  /** The root's `studyflow:categories`; empty when the diagram declares none. */
  categories: string[];
};

/** Roots a diagram can have, in the order they answer "what is this diagram?". */
const ROOT_TYPES = ['process', 'collaboration', 'choreography'];

export function humanizeId(id: string): string {
  return id.replace(/[_-]+/g, ' ').trim();
}

export function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

/** Root elements of a `bpmn:Definitions`, in the priority above. */
function rootsOf(doc: Document, ns: MetadataNamespaces): Element[] {
  const roots = [
    ...ROOT_TYPES.flatMap((type) => [...doc.getElementsByTagNameNS(ns.bpmn, type)]),
    ...doc.getElementsByTagNameNS(ns.core, 'study'),
    ...(ns.legacyCore ? [...doc.getElementsByTagNameNS(ns.legacyCore, 'study')] : []),
  ];
  // A sub-process is a `bpmn:process` in name only when it is not a root.
  return roots.filter((el) => el.parentElement?.localName === 'definitions');
}

/**
 * The shelves one root declares: `<studyflow:categories>` child elements, or
 * the single `studyflow:category` attribute files written before the property
 * went many-valued carry (see `Classification#categories.meta.legacyNames`).
 */
function categoriesOf(root: Element, ns: MetadataNamespaces): string[] {
  const declared = Array.from(root.children)
    .filter((child) => (child.namespaceURI === ns.core || child.namespaceURI === ns.legacyCore)
      && child.localName === 'categories')
    .map((child) => child.textContent?.trim() ?? '')
    .filter(Boolean);
  if (declared.length > 0) return declared;

  const legacy = studyflowAttribute(root, ns, 'category')?.trim();
  return legacy ? [legacy] : [];
}

export function parseXmlExampleMetadata(
  xml: string,
  ns: MetadataNamespaces,
): { name?: string; id?: string; description?: string; categories: string[] } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid XML');

  const roots = rootsOf(doc, ns);
  const primary = roots[0];
  if (!primary) return { categories: [] };

  return {
    name: primary.getAttribute('name')?.trim() || undefined,
    id: primary.getAttribute('id') ?? undefined,
    description: Array.from(primary.children).find(
      (c) => c.namespaceURI === ns.bpmn && c.localName === 'documentation'
        && studyflowAttribute(c, ns, 'checklist') !== 'true',
    )?.textContent?.trim() || undefined,
    // A collaboration and the process it wraps are both roots, and the
    // inspector writes to whichever one the canvas shows: take the categories
    // from whichever root carries them.
    categories: roots.map((root) => categoriesOf(root, ns)).find((list) => list.length > 0) ?? [],
  };
}

/** Title, blurb, and shelves of an example, read out of its embedded diagram. */
export function readExampleMetadata(
  filename: string,
  png: ArrayBuffer,
  ns: MetadataNamespaces,
): ExampleMetadata {
  const meta = parseXmlExampleMetadata(extractXmlFromPng(png), ns);
  return {
    title: meta.name || (meta.id ? humanizeId(meta.id) : '') || filenameStem(filename),
    summary: firstSentence(meta.description ?? ''),
    categories: meta.categories,
  };
}
