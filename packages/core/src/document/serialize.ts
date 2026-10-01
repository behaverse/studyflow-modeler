import { isModdleElement } from '@core/element/moddle';
import { RESERVED_DOC_KEYS, STUDY_EXTENSION_TYPE, inferredRoot, isHeadlessCollaboration, type YamlDoc } from '@core/document/format';
import { readState } from '@core/document/state';
import {
  flowEndsOf,
  inlineDocumentationEntries,
  inlineElementList,
  inlineExpressionBody,
  foldTypedElement,
  isImpliedFlowList,
  isRedundantNamespaceDeclaration,
  planInlineDi,
  type FlowEnds,
} from '@core/document/shorthand';
import { DI_NODE_TYPES, compactDiNode, inlineYamlValue, impliedTypeName, keyItemsById, shortTypeName } from '@core/model/spelling';

type SerializeContext = {
  di: Map<string, Record<string, unknown>>;
  foldedIds: Set<string>;
  /** The drawing of each element by id, written as the document's one `layout:` map rather than on the elements. */
  layout: Record<string, Record<string, unknown>>;
  /** What the document contains; a reference to anything else could not be read back. */
  held: Set<unknown>;
  /** Each container's sequence flows by their ends, built once per run: what `incoming` and `outgoing` are checked against. */
  flowEnds: Map<unknown, FlowEnds>;
  onWarning?: (message: string) => void;
};

function flowEndsIn(ctx: SerializeContext, container: unknown): FlowEnds {
  const known = ctx.flowEnds.get(container);
  if (known) return known;
  const ends = flowEndsOf(container);
  ctx.flowEnds.set(container, ends);
  return ends;
}

/** Every element `definitions` contains, as opposed to one it only references. */
function heldElements(definitions: any): Set<unknown> {
  const held = new Set<unknown>();
  const visit = (el: any): void => {
    if (!isModdleElement(el) || held.has(el)) return;
    held.add(el);
    for (const p of el.$descriptor?.properties ?? []) {
      if (p.isReference) continue;
      const value = el[p.name];
      for (const child of Array.isArray(value) ? value : [value]) visit(child);
    }
  };
  visit(definitions);
  return held;
}

/** `ref`, unless it names an element the document does not hold: that is left out, with a warning. */
function heldReference(el: any, key: string, ref: any, ctx: SerializeContext | undefined): any {
  if (!ctx || !isModdleElement(ref) || ctx.held.has(ref)) return ref;
  ctx.onWarning?.(`'${el.id ?? el.$type}' refers by ${key} to '${ref.id ?? ref.$type}', which the document does not hold; the reference was left out`);
  return undefined;
}

function serializeValue(value: any, declaredType: string | undefined, ctx?: SerializeContext): unknown {
  if (!isModdleElement(value)) return value;
  return (
    inlineExpressionBody(value)
    ?? inlineElementList(value, (item) => serializeValue(item, undefined, ctx))
    ?? serializeElement(value, declaredType, ctx)
  );
}

/** What an element is and what it is called come first, whatever order moddle's descriptor lists them in. */
function nameFirst(out: Record<string, unknown>): Record<string, unknown> {
  if (!('name' in out)) return out;
  const { type, name, ...rest } = out;
  return { ...(type === undefined ? {} : { type }), name, ...rest };
}

/** An element of a namespace no loaded schema declares: its attributes, then its child elements' texts by local name,
 * always a list, so a child reads back as a child and an attribute as an attribute. */
function serializeForeign(el: any): Record<string, unknown> {
  const out: Record<string, unknown> = { type: el.$type };
  for (const [key, value] of Object.entries(el)) if (!key.startsWith('$') && typeof value !== 'object') out[key] = value;
  for (const child of el.$children ?? []) {
    const key = String(child.$type).split(':').pop()!;
    out[key] = [...(out[key] as string[] | undefined ?? []), String(child.$body ?? '').trim()];
  }
  return out;
}

function serializeElement(el: any, declaredType?: string, ctx?: SerializeContext): Record<string, unknown> {
  if (el.$descriptor?.isGeneric) return serializeForeign(el);
  const out: Record<string, unknown> = {};
  // Its drawing, keyed before its children's so the layout reads in document order.
  const di = ctx && typeof el.id === 'string' ? ctx.di.get(el.id) : undefined;
  if (di && ctx) {
    ctx.layout[el.id] = di;
    ctx.foldedIds.add(el.id);
  }
  if (el.$type !== declaredType) out.type = shortTypeName(el.$type);

  for (const p of el.$descriptor?.properties ?? []) {
    const value = el[p.name];
    if (value === undefined || value === null) continue;
    if (p.default !== undefined && value === p.default) continue;
    // The run state is the document's top-level `state:` mapping, not a JSON string on the Study node.
    if (p.name === 'state' && el.$type === STUDY_EXTENSION_TYPE) continue;
    // A cross-namespace property (a schema redefine of `bpmn:loopCondition`) reads by its local name like every other key.
    const key = p.ns?.localName ?? p.name;

    if (p.isMany) {
      if (!Array.isArray(value) || value.length === 0) continue;
      if (p.isReference) {
        if ((key === 'incoming' || key === 'outgoing') && isImpliedFlowList(el, key, value, ctx && flowEndsIn(ctx, el.$parent))) continue;
        const ids = value.map((ref: any) => heldReference(el, key, ref, ctx)?.id).filter((id: unknown) => id !== undefined);
        if (ids.length > 0) out[key] = ids;
        continue;
      }
      const docs = inlineDocumentationEntries(value);
      if (docs) {
        out[key] = docs;
        continue;
      }
      const items = value.map((item: any) => serializeValue(item, p.type, ctx));
      out[key] = keyItemsById(items) ?? items;
      continue;
    }

    if (p.isReference) {
      const id = heldReference(el, key, value, ctx)?.id;
      if (id !== undefined) out[key] = id;
      continue;
    }
    out[key] = inlineYamlValue(value, p) ?? serializeValue(value, p.type, ctx);
  }

  for (const [name, value] of Object.entries(el.$attrs ?? {})) {
    if (!(name in out) && !isRedundantNamespaceDeclaration(el, name)) out[name] = value;
  }
  if (DI_NODE_TYPES.has(el.$type)) compactDiNode(out);
  if (out.type !== undefined && impliedTypeName(out, declaredType) === el.$type) delete out.type;
  return nameFirst(ctx ? foldTypedElement(el, out) : out);
}

function serializeLeftoverDiagrams(definitions: any, ctx: SerializeContext): unknown[] {
  const diagrams: any[] = definitions.diagrams ?? [];
  // A plane naming the root the reader would infer without it, or a collaboration with no pool (it draws that same
  // root), says nothing. A plane naming a process beside a pool's collaboration says which one is drawn.
  const redundantRootIds = new Set<string | undefined>([
    inferredRoot(definitions)?.id,
    ...(definitions?.rootElements ?? []).filter(isHeadlessCollaboration).map((root: any) => root.id),
  ]);
  return diagrams.flatMap((diagram, index) => {
    const node = serializeElement(diagram, 'bpmndi:BPMNDiagram') as Record<string, any>;
    const plane = node.plane as Record<string, any> | undefined;
    if (index === 0 && plane && plane.planeElement) {
      const folded = (pe: any) => typeof pe?.bpmnElement === 'string' && ctx.foldedIds.has(pe.bpmnElement);
      if (Array.isArray(plane.planeElement)) {
        const remaining = plane.planeElement.filter((pe: any) => !folded(pe));
        if (remaining.length > 0) plane.planeElement = remaining;
        else delete plane.planeElement;
      } else {
        const remaining = Object.entries(plane.planeElement).filter(([, pe]) => !folded(pe));
        if (remaining.length > 0) plane.planeElement = Object.fromEntries(remaining);
        else delete plane.planeElement;
      }
    }
    const redundant = index === 0 && diagrams.length === 1 && isRedundantDiagramNode(node, redundantRootIds);
    return redundant ? [] : [node];
  });
}

function isRedundantDiagramNode(node: Record<string, any>, redundantRootIds: Set<string | undefined>): boolean {
  if (Object.keys(node).some((key) => key !== 'id' && key !== 'plane')) return false;
  const plane = node.plane as Record<string, any> | undefined;
  if (!plane) return true;
  if (Object.keys(plane).some((key) => key !== 'id' && key !== 'bpmnElement')) return false;
  return plane.bpmnElement === undefined || redundantRootIds.has(plane.bpmnElement);
}

/** `onWarning` hears each reference left out because it names an element the document does not hold. */
export function definitionsToYamlDoc(definitions: any, onWarning?: (message: string) => void): YamlDoc {
  const ctx: SerializeContext = {
    di: planInlineDi(definitions, (el, declaredType) => serializeElement(el, declaredType)),
    foldedIds: new Set(),
    layout: {},
    held: heldElements(definitions),
    flowEnds: new Map(),
    onWarning,
  };
  const serialized = serializeElement(definitions, 'bpmn:Definitions', ctx);
  const { rootElements, diagrams: _diagrams, id, ...rest } = serialized;
  const diagram = serializeLeftoverDiagrams(definitions, ctx);

  const doc: YamlDoc = {};
  if (id !== undefined) doc.id = id;
  doc.definitions = rest;

  const unkeyable: unknown[] = [];
  if (Array.isArray(rootElements)) {
    unkeyable.push(...rootElements);
  } else {
    for (const [key, body] of Object.entries((rootElements as Record<string, unknown>) ?? {})) {
      if (!RESERVED_DOC_KEYS.has(key) && !(key in doc)) doc[key] = body;
      else unkeyable.push({ id: key, ...(body as object) });
    }
  }
  if (unkeyable.length > 0) doc.elements = unkeyable;

  // The drawing apart from the protocol: a layout edit is a diff of this map alone.
  if (Object.keys(ctx.layout).length > 0) doc.layout = ctx.layout;
  if (diagram.length > 0) doc.diagram = diagram;
  const state = readState(definitions);
  if (Object.keys(state).length > 0) doc.state = state;
  return doc;
}
