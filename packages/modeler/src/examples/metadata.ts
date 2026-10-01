import { documentationOf, type Element, type StudyModel } from '@core/model/index';
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
export function exampleMetadata(model: StudyModel, fallback: string): ExampleMetadata {
  const primary = model.primaryRoot();
  const others = model.study.roots.filter((root) => root !== primary && ROOT_TYPES.some((type) => model.isA(root, type)));
  const roots = primary ? [primary, ...others] : others;
  const first = (read: (root: Element) => string | undefined) => roots.map(read).find(Boolean);

  const name = first((root) => (typeof root.name === 'string' ? root.name.trim() : undefined));
  const id = first((root) => root.id);
  const documentation = first(documentationOf);
  return {
    title: name || id?.replace(/[_-]+/g, ' ').trim() || fallback,
    summary: firstSentence(documentation ?? ''),
  };
}
