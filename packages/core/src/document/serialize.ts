import { isModdleElement } from '@behaverse/studyflow-core/element/moddle';
import { RESERVED_DOC_KEYS, inferPlaneRoot, type YamlDoc } from '@behaverse/studyflow-core/document/format';
import {
  CHECKLIST_MARKER,
  inlineDocumentationEntries,
  inlineElementList,
  inlineExpressionBody,
  inlineYamlBody,
  inlineYamlValue,
  keyItemsById,
  planInlineDi,
} from '@behaverse/studyflow-core/document/shorthand';

type SerializeContext = {
  di: Map<string, Record<string, unknown>>;
  foldedIds: Set<string>;
};

function serializeValue(value: any, declaredType: string | undefined, ctx?: SerializeContext): unknown {
  if (!isModdleElement(value)) return value;
  return (
    inlineYamlBody(value)
    ?? inlineExpressionBody(value)
    ?? inlineElementList(value, (item) => serializeValue(item, undefined, ctx))
    ?? serializeElement(value, declaredType, ctx)
  );
}

function serializeElement(el: any, declaredType?: string, ctx?: SerializeContext): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (el.$type !== declaredType) out.type = el.$type;

  for (const p of el.$descriptor?.properties ?? []) {
    const value = el[p.name];
    if (value === undefined || value === null) continue;
    if (p.default !== undefined && value === p.default) continue;
    // A cross-namespace property (a schema redefine of `bpmn:loopCondition`) reads by its local name like every other key.
    const key = p.ns?.localName ?? p.name;

    if (p.isMany) {
      if (!Array.isArray(value) || value.length === 0) continue;
      if (p.isReference) {
        out[key] = value.map((ref: any) => ref?.id);
        continue;
      }
      const docs = inlineDocumentationEntries(value);
      if (docs) {
        if (docs.documentation !== undefined) out[key] = docs.documentation;
        if (docs.checklist !== undefined) out[CHECKLIST_MARKER] = docs.checklist;
        continue;
      }
      const items = value.map((item: any) => serializeValue(item, p.type, ctx));
      out[key] = keyItemsById(items) ?? items;
      continue;
    }

    out[key] = p.isReference ? value?.id : inlineYamlValue(value, p) ?? serializeValue(value, p.type, ctx);
  }

  for (const [name, value] of Object.entries(el.$attrs ?? {})) {
    if (!(name in out)) out[name] = value;
  }

  const di = ctx && typeof el.id === 'string' ? ctx.di.get(el.id) : undefined;
  if (di && ctx && Object.keys(di).every((key) => !(key in out))) {
    Object.assign(out, di);
    ctx.foldedIds.add(el.id);
  }

  return out;
}

function serializeLeftoverDiagrams(definitions: any, ctx: SerializeContext): unknown[] {
  const diagrams: any[] = definitions.diagrams ?? [];
  const inferredRootId = inferPlaneRoot(definitions)?.id;
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
    const redundant = index === 0 && diagrams.length === 1 && isRedundantDiagramNode(node, inferredRootId);
    return redundant ? [] : [node];
  });
}

function isRedundantDiagramNode(node: Record<string, any>, inferredRootId: string | undefined): boolean {
  if (Object.keys(node).some((key) => key !== 'id' && key !== 'plane')) return false;
  const plane = node.plane as Record<string, any> | undefined;
  if (!plane) return true;
  if (Object.keys(plane).some((key) => key !== 'id' && key !== 'bpmnElement')) return false;
  return plane.bpmnElement === undefined || plane.bpmnElement === inferredRootId;
}

export function definitionsToYamlDoc(definitions: any): YamlDoc {
  const ctx: SerializeContext = {
    di: planInlineDi(definitions, (el, declaredType) => serializeElement(el, declaredType)),
    foldedIds: new Set(),
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

  if (diagram.length > 0) doc.diagram = diagram;
  return doc;
}
