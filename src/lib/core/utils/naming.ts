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
