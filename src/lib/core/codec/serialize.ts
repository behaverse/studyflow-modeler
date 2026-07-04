import * as yaml from 'js-yaml';

import { toLocalName } from '../naming';
import {
  RESERVED_DOC_KEYS,
  inferPlaneRoot,
  isModdleElement,
  keyItemsById,
  valueTypeOf,
  type YamlDoc,
} from './common';

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
  return inlineYamlBody(value) ?? unwrapElementList(value, ctx) ?? serializeElement(value, declaredType, ctx);
}

/**
 * Config wrappers whose whole content is a YAML body (`cognitive:Configurations`
 * and friends) inline that body as nested YAML. Bodies that don't parse to a
 * non-empty mapping — or that would be re-read as the wrapped form — stay wrapped.
 */
function inlineYamlBody(el: any): Record<string, unknown> | undefined {
  const props: any[] = el.$descriptor?.properties ?? [];
  const body = props.find((p) => p.isBody);
  if (!body || toLocalName(valueTypeOf(body)) !== 'YAMLString') return undefined;
  if (typeof el[body.name] !== 'string' || el[body.name] === '') return undefined;
  if (Object.keys(el.$attrs ?? {}).length > 0) return undefined;
  for (const p of props) {
    if (p === body) continue;
    const value = el[p.name];
    if (value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0)) return undefined;
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(el[body.name]);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;

  const keys = Object.keys(parsed);
  const byName = el.$descriptor?.propertiesByName ?? {};
  if (keys.length === 0 || 'type' in parsed) return undefined;
  if (keys.every((key) => key in byName)) return undefined;
  return parsed as Record<string, unknown>;
}

/**
 * Value-typed YAML properties (`studyflow:with`) inline their parsed mapping
 * as nested YAML, like YAML-bodied wrappers do. Values that don't parse to a
 * non-empty mapping stay strings, as do mappings carrying a `type` key — on
 * load a `type` key means "build an element". Bodies are excluded: those fold
 * at the wrapper level (`inlineYamlBody`) with its own ambiguity guards.
 */
function inlineYamlValue(value: any, prop: any): Record<string, unknown> | undefined {
  if (prop.isBody || toLocalName(valueTypeOf(prop)) !== 'YAMLString') return undefined;
  if (typeof value !== 'string' || value === '') return undefined;

  let parsed: unknown;
  try {
    parsed = yaml.load(value);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const keys = Object.keys(parsed);
  if (keys.length === 0 || 'type' in parsed) return undefined;
  return parsed as Record<string, unknown>;
}

/**
 * List wrappers — types whose only content property is a single isMany list
 * (`bpmn:ExtensionElements#values`) — collapse to the plain list.
 */
function unwrapElementList(el: any, ctx?: SerializeContext): unknown[] | undefined {
  const props: any[] = el.$descriptor?.properties ?? [];
  const content = props.filter((p) => !p.isAttr && !p.isReference && !p.isBody);
  if (content.length !== 1 || !content[0].isMany) return undefined;
  if (Object.keys(el.$attrs ?? {}).length > 0) return undefined;
  for (const p of props) {
    if (p === content[0]) continue;
    if (el[p.name] !== undefined && el[p.name] !== null) return undefined;
  }
  const items = el[content[0].name];
  if (!Array.isArray(items) || items.length === 0) return undefined;
  return items.map((item: any) => serializeValue(item, undefined, ctx));
}

function serializeElement(el: any, declaredType?: string, ctx?: SerializeContext): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (el.$type !== declaredType) out.type = el.$type;

  for (const p of el.$descriptor?.properties ?? []) {
    const value = el[p.name];
    if (value === undefined || value === null) continue;
    if (p.default !== undefined && value === p.default) continue;

    if (p.isMany) {
      if (!Array.isArray(value) || value.length === 0) continue;
      if (p.isReference) {
        out[p.name] = value.map((ref: any) => ref?.id);
        continue;
      }
      const items = value.map((item: any) => serializeValue(item, p.type, ctx));
      out[p.name] = keyItemsById(items) ?? items;
      continue;
    }

    out[p.name] = p.isReference ? value?.id : inlineYamlValue(value, p) ?? serializeValue(value, p.type, ctx);
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

/** DI reference properties point at other DI elements whose ids are regenerated on load. */
const UNFOLDABLE_DI_KEYS = new Set(['sourceElement', 'targetElement', 'choreographyActivityShape']);

/** Map semantic element ids to the DI payload of their planeElement (primary diagram only). */
function planDiFolding(definitions: any): Map<string, Record<string, unknown>> {
  const byId = new Map<string, Record<string, unknown>>();
  const seen = new Set<string>();
  for (const pe of definitions.diagrams?.[0]?.plane?.planeElement ?? []) {
    const refId = pe?.bpmnElement?.id;
    if (typeof refId !== 'string' || refId === '') continue;
    if (seen.has(refId)) {
      byId.delete(refId); // two planeElements for one element: ambiguous, keep both in `diagram:`
      continue;
    }
    seen.add(refId);
    const payload = foldablePayload(pe);
    if (payload) byId.set(refId, payload);
  }
  return byId;
}

function foldablePayload(pe: any): Record<string, unknown> | undefined {
  if (pe.$type !== 'bpmndi:BPMNShape' && pe.$type !== 'bpmndi:BPMNEdge') return undefined;
  if (Object.keys(pe.$attrs ?? {}).length > 0) return undefined; // unclassifiable on load
  const node = serializeElement(pe, pe.$type);
  delete node.id; // regenerated as `<elementId>_di` on load
  delete node.bpmnElement;
  for (const key of Object.keys(node)) if (UNFOLDABLE_DI_KEYS.has(key)) return undefined;
  return node;
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
  const ctx: SerializeContext = { di: planDiFolding(definitions), foldedIds: new Set() };
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
