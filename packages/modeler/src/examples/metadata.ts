import { isChecklistEntry, primaryRoot } from '@core/document';
import { firstSentence } from '@core/naming';

export type ExampleMetadata = {
  title: string;
  summary: string;
};

/** The roots a card may read besides the drawn one: a pool diagram splits its name and blurb across its collaboration and process. */
const ROOT_TYPES = ['bpmn:Process', 'bpmn:Collaboration', 'bpmn:Choreography'];

/**
 * A card's title and blurb, from the example's own roots: the drawn root leads, and a field it
 * lacks is read from the next root carrying it. `fallback` titles a diagram that names nothing.
 */
export function exampleMetadata(definitions: any, fallback: string): ExampleMetadata {
  const primary = primaryRoot(definitions);
  const others = (definitions.rootElements ?? [])
    .filter((root: any) => root !== primary && ROOT_TYPES.some((type) => root.$instanceOf(type)));
  const roots = primary ? [primary, ...others] : others;
  const first = (read: (root: any) => string | undefined) => roots.map(read).find(Boolean);

  const name = first((root) => root.name?.trim());
  const id = first((root) => root.id);
  const documentation = first((root) => root.documentation?.find((entry: any) => !isChecklistEntry(entry))?.text?.trim());
  return {
    title: name || id?.replace(/[_-]+/g, ' ').trim() || fallback,
    summary: firstSentence(documentation ?? ''),
  };
}
