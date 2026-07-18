import { RESERVED_DOC_KEYS, inferPlaneRoot, isModdleElement, type YamlDoc } from '@/core/codec/common';
import { unwrapElementList } from '@/core/codec/foldings/element-list';
import { keyItemsById } from '@/core/codec/foldings/id-keyed';
import { planDiFolding } from '@/core/codec/foldings/inline-di';
import { inlineYamlBody, inlineYamlValue } from '@/core/codec/foldings/yaml-body';

/**
 * The write direction of the codec: a moddle `bpmn:Definitions` tree walks
 * down to the plain `.studyflow` YAML document, applying the readability
 * foldings documented in `index.ts` (id-keyed containment, wrapper collapse,
 * inline YAML bodies, inline diagram geometry).
 */

type SerializeContext = {
  /** Semantic element id -> foldable DI payload (bounds, label, waypoint, colors...). */
  di: Map<string, Record<string, unknown>>;
  /** Ids whose planeElement was folded into the element; drives leftover filtering. */
  foldedIds: Set<string>;
};

function serializeValue(value: any, declaredType: string | undefined, ctx?: SerializeContext): unknown {
  if (!isModdleElement(value)) return value;
  return (
    inlineYamlBody(value)
    ?? inlineExpressionBody(value)
    ?? unwrapElementList(value, (item) => serializeValue(item, undefined, ctx))
    ?? serializeElement(value, declaredType, ctx)
  );
}

/** FOLD (serialize): a BPMN expression child whose only content is its `body`
 *  (`<conditionExpression xsi:type="tFormalExpression">text</...>`) inlines
 *  as the flat string the schemas document. */
function inlineExpressionBody(el: any): string | undefined {
  if (el.$type !== 'bpmn:FormalExpression' && el.$type !== 'bpmn:Expression') return undefined;
  if (typeof el.body !== 'string' || el.body === '') return undefined;
  // `xsi:type` is the instantiation marker the parser records, not content.
  if (Object.keys(el.$attrs ?? {}).some((name) => name !== 'xsi:type')) return undefined;
  return onlyBodySet(el, 'body') ? el.body : undefined;
}

/** FOLD (serialize): `bpmn:documentation` children carrying only their `text`
 *  inline as flat strings under two keys - prose entries as `documentation`
 *  (a single one as the string itself), the `studyflow:checklist`-marked
 *  entry as `checklist`. */
function inlineDocumentationEntries(
  value: any[],
): { documentation?: string | string[]; checklist?: string } | undefined {
  const prose: string[] = [];
  let checklist: string | undefined;
  for (const item of value) {
    if (!isModdleElement(item) || item.$type !== 'bpmn:Documentation') return undefined;
    if (typeof item.text !== 'string' || item.text === '') return undefined;
    if (Object.keys(item.$attrs ?? {}).length > 0) return undefined;
    const marked = item.get('checklist') === true;
    if (!onlyBodySet(item, 'text', marked ? ['checklist'] : [])) return undefined;
    if (marked) {
      if (checklist !== undefined) return undefined;
      checklist = item.text;
    } else {
      prose.push(item.text);
    }
  }
  return {
    documentation: prose.length === 0 ? undefined : prose.length === 1 ? prose[0] : prose,
    checklist,
  };
}

/** True when every property other than `bodyName` (and `allowed` markers) is
 *  unset or its declared default (moddle materializes defaults, e.g.
 *  `textFormat: text/plain`). */
function onlyBodySet(el: any, bodyName: string, allowed: string[] = []): boolean {
  for (const p of el.$descriptor?.properties ?? []) {
    if (p.name === bodyName || allowed.includes(p.name)) continue;
    const value = el[p.name];
    if (value === undefined || value === null) continue;
    if (p.default !== undefined && value === p.default) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    return false;
  }
  return true;
}

function serializeElement(el: any, declaredType?: string, ctx?: SerializeContext): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (el.$type !== declaredType) out.type = el.$type;

  for (const p of el.$descriptor?.properties ?? []) {
    const value = el[p.name];
    if (value === undefined || value === null) continue;
    if (p.default !== undefined && value === p.default) continue;
    // A cross-namespace property (`bpmn:loopCondition` redefined from a
    // schema) reads by its local name in YAML, like every other key.
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
        if (docs.checklist !== undefined) out['checklist'] = docs.checklist;
        continue;
      }
      const items = value.map((item: any) => serializeValue(item, p.type, ctx));
      out[key] = keyItemsById(items) ?? items;
      continue;
    }

    out[key] = p.isReference ? value?.id : inlineYamlValue(value, p) ?? serializeValue(value, p.type, ctx);
  }

  // Raw XML attributes unknown to the schemas (e.g. template icon overrides).
  for (const [name, value] of Object.entries(el.$attrs ?? {})) {
    if (!(name in out)) out[name] = value;
  }

  // Fold this element's diagram geometry in (skipped on any key collision —
  // the planeElement then stays under the top-level `diagram:` instead).
  const di = ctx && typeof el.id === 'string' ? ctx.di.get(el.id) : undefined;
  if (di && ctx && Object.keys(di).every((key) => !(key in out))) {
    Object.assign(out, di);
    ctx.foldedIds.add(el.id);
  }

  return out;
}

/** Whatever DI did not fold inline: extra diagrams, exotic planeElements. */
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

/** True when the diagram is fully implied by the document and can be regenerated. */
function isRedundantDiagramNode(node: Record<string, any>, inferredRootId: string | undefined): boolean {
  if (Object.keys(node).some((key) => key !== 'id' && key !== 'plane')) return false;
  const plane = node.plane as Record<string, any> | undefined;
  if (!plane) return true;
  if (Object.keys(plane).some((key) => key !== 'id' && key !== 'bpmnElement')) return false;
  return plane.bpmnElement === undefined || plane.bpmnElement === inferredRootId;
}

/** Serialize a `bpmn:Definitions` tree into the `.studyflow` YAML document. */
export function definitionsToYamlDoc(definitions: any): YamlDoc {
  const ctx: SerializeContext = {
    di: planDiFolding(definitions, (el, declaredType) => serializeElement(el, declaredType)),
    foldedIds: new Set(),
  };
  const serialized = serializeElement(definitions, 'bpmn:Definitions', ctx);
  const { rootElements, diagrams: _diagrams, id, ...rest } = serialized;
  const diagram = serializeLeftoverDiagrams(definitions, ctx);

  const doc: YamlDoc = {};
  if (id !== undefined) doc.id = id;
  doc.definitions = rest;

  // Root elements live at the document root, keyed by id; anything unkeyable
  // (no id, or an id that collides with a reserved key) falls back to the
  // legacy `elements:` list.
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
