export function splitQName(qname: string | undefined): { prefix: string | undefined; localName: string | undefined } {
  if (!qname) return { prefix: undefined, localName: undefined };
  const idx = qname.indexOf(':');
  if (idx === -1) return { prefix: undefined, localName: qname };
  return { prefix: qname.slice(0, idx), localName: qname.slice(idx + 1) };
}

export function toLocalName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const idx = name.indexOf(':');
  return idx === -1 ? name : name.slice(idx + 1);
}

export function toPrefix(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const idx = name.indexOf(':');
  return idx === -1 ? undefined : name.slice(0, idx);
}

/**
 * The opening sentence of a block of prose.
 *
 * Used wherever a one-line blurb is wanted from text an author already wrote
 * (a schema's `description`, a diagram's `documentation`) rather than from a
 * second summary maintained beside it. A period only ends a sentence when the
 * next word starts one — otherwise `pandas.DataFrame` and `e.g. a survey`
 * would cut the blurb short.
 */
export function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return (flat.match(/^.*?[.!?](?=\s+[A-Z(“"]|\s*$)/)?.[0] ?? flat).trim();
}
