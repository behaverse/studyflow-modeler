import { isModdleElement } from '@core/document/moddle';
import { literal, PROPERTY_VALUE } from '@core/engine/graph';
import type { YamlDoc } from '@core/model/yaml';

/*
 * moddle's tree as the long form of a `.studyflow.yaml` document, for the study model's reader (`readStudy`), whose
 * every short form, drawing and root rule then applies as it does to a file: each element its type (left out where the
 * property holding it declares that type), each property under its local name, a list as a list, a reference as the id
 * it names, a property's value as the literal its text is, the drawing as the diagram it is, and the run state as the
 * XML keeps it, a JSON text on the Study.
 */

/** Recorded by moddle's reader on an `xsi:type`d element, whose type already says it; moddle's writer writes it again. */
const XSI_TYPE = 'xsi:type';

/** An element of a namespace no loaded schema declares: its attributes, then its child elements' texts by local name,
 * always a list, so a child reads back as a child and an attribute as an attribute. */
function foreign(el: any): Record<string, unknown> {
  const out: Record<string, unknown> = { type: el.$type };
  for (const [key, value] of Object.entries(el)) if (!key.startsWith('$') && typeof value !== 'object') out[key] = value;
  for (const child of el.$children ?? []) {
    const key = String(child.$type).split(':').pop()!;
    out[key] = [...(out[key] as string[] | undefined ?? []), String(child.$body ?? '').trim()];
  }
  return out;
}

function element(el: any, declaredType?: string): Record<string, unknown> {
  if (el.$descriptor?.isGeneric) return foreign(el);
  const out: Record<string, unknown> = {};
  if (el.$type !== declaredType) out.type = el.$type;
  for (const p of el.$descriptor?.properties ?? []) {
    const value = el[p.name];
    if (value === undefined || value === null || (p.default !== undefined && value === p.default)) continue;
    if (p.isMany && (!Array.isArray(value) || value.length === 0)) continue;
    // A cross-namespace property (a schema redefine of `bpmn:loopCondition`) reads by its local name like every other key.
    const key = p.ns?.localName ?? p.name;
    if (p.isReference) {
      const ids = (p.isMany ? value : [value]).map((ref: any) => ref?.id).filter((id: unknown) => typeof id === 'string');
      if (ids.length > 0) out[key] = p.isMany ? ids : ids[0];
      continue;
    }
    const item = (child: unknown): unknown => (isModdleElement(child) ? element(child, p.type) : child);
    out[key] = p.ns?.name === PROPERTY_VALUE ? literal(value) : p.isMany ? value.map(item) : item(value);
  }
  for (const [name, value] of Object.entries(el.$attrs ?? {})) if (name !== XSI_TYPE && !(name in out)) out[name] = value;
  return out;
}

/** The document moddle's `definitions` spell, in the long form. */
export function definitionsToYamlDoc(definitions: any): YamlDoc {
  const { id, rootElements, diagrams, ...rest } = element(definitions, 'bpmn:Definitions');
  const doc: YamlDoc = { definitions: rest };
  if (id !== undefined) doc.id = id;
  if (rootElements !== undefined) doc.elements = rootElements;
  if (diagrams !== undefined) doc.diagram = diagrams;
  return doc;
}
