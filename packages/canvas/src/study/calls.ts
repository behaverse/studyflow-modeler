/**
 * A study's tools as `Study.call` runs them, by name, on an argument its tool's schema admits: each write a verb of
 * the study, each read a record of it; and what the reads answer beyond the records, what an element type takes.
 */

import { getAttributeSpec } from '@core/element/index.ts';
import type { Element, StudyModel } from '@core/model/index.ts';
import { isBpmnSubtypeOf } from '@core/notation/bpmn.ts';
import { getCatalog, hasCatalog } from '@core/notation/index.ts';

import { attributesOf } from '@canvas/study/attributes.ts';
import { mintTyped, type NewElement, type NewShape } from '@canvas/study/prototype.ts';
import type { ElementRecord } from '@canvas/study/records.ts';
import type { BandsChange, ChangedIds, Study, StudyResult } from '@canvas/study/Study.ts';
import { shapeOf } from '@canvas/study/templates.ts';
import { isStepTool, misfitOf, type ArgsOf, type StepTool, type StructureRecord, type ToolName, type ToolResult } from '@canvas/study/tools.ts';

export const NOTHING: ChangedIds = { added: [], changed: [], removed: [] };

export function refused(reason: string): StudyResult {
  return { ok: false, reason, ...NOTHING };
}

/** A write tool as a batch runs it: on `args` checked against the tool's schema; one that throws is refused. */
export function runStep(study: Study, tool: string, args: unknown): StudyResult {
  const misfit = misfitOf(tool, args);
  if (misfit) return refused(misfit);
  if (!isStepTool(tool)) return refused(`a batch runs no '${tool}'`);
  // Each verb takes what its tool's schema admits, or this does not compile. A new element is the one the schema
  // says less of than the verb asks: one with neither a `type` nor a `template` is refused when it is made.
  const verbs: { [Tool in StepTool]: (args: ArgsOf<Tool>) => StudyResult } = {
    add: (a) => study.add(a as ArgsOf<'add'> & NewElement),
    append: (a) => study.append(a as ArgsOf<'append'> & NewElement),
    connect: (a) => study.connect(a),
    replace: (a) => study.replace(a),
    move: (a) => study.move(a),
    reconnect: (a) => study.reconnect(a),
    rename: (a) => study.rename(a),
    resize: (a) => study.resize(a),
    reroute: (a) => study.reroute(a),
    paste: (a) => study.paste(a),
    layout: () => study.layout(),
    set: (a) => study.set(a),
    item: (a) => study.item(a),
    bands: (a) => study.bands(a as ArgsOf<'bands'> & BandsChange),
    remove: (a) => study.remove(a),
    style: (a) => study.style(a),
    expand: (a) => study.expand(a),
    collapse: (a) => study.collapse(a),
  };
  try {
    return (verbs[tool] as (args: unknown) => StudyResult)(args);
  } catch (error) {
    return refused(error instanceof Error ? error.message : String(error));
  }
}

/** A tool that is no step of a batch, on an argument its schema admits: a read, a batch, undo or redo. */
export function runRead(study: Study, name: string, args: unknown): ToolResult {
  // What passed a tool's schema is what its schema admits.
  const as = <Tool extends ToolName>(_tool: Tool): ArgsOf<Tool> => args as ArgsOf<Tool>;
  switch (name as Exclude<ToolName, StepTool>) {
    case 'document': return { ok: true, yaml: study.toYaml() };
    case 'copy': return study.copy(as('copy'));
    case 'get': {
      const { id } = as('get');
      const element = study.get(id);
      return element ? { ok: true, element } : refused(`no element '${id}'`);
    }
    case 'list': {
      const { name: part, geometry, ...filter } = as('list');
      const wanted = part?.toLowerCase();
      const found = study.list(filter).filter((element) => wanted === undefined || element.name?.toLowerCase().includes(wanted));
      return { ok: true, elements: geometry ? found : found.map(undrawn) };
    }
    case 'describe': return study.describe(as('describe'));
    case 'catalog': return { ok: true, ...study.catalog() };
    case 'can': return study.can(as('can').tool, as('can').args);
    case 'attributes': {
      const { id } = as('attributes');
      const attributes = study.attributes(id);
      return attributes ? { ok: true, attributes } : refused(`no element '${id}'`);
    }
    case 'batch': return study.batch(as('batch'));
    case 'undo': return study.undo();
    case 'redo': return study.redo();
  }
  return refused(`no tool '${name}'`);
}

/** A record without where it is drawn: what an element is, and how it connects. */
function undrawn({ bounds: _bounds, waypoints: _waypoints, fill: _fill, stroke: _stroke, font: _font, pinned: _pinned, ...what }: ElementRecord): ElementRecord {
  return what;
}

/**
 * What an element of `type` takes, before one exists: its schema's attributes (with `extension`, that schema type's
 * too), and the properties BPMN gives it, which `set` takes as the file spells them.
 */
export function describeType(model: StudyModel, args: { type: string; extension?: string }): ToolResult {
  const misfit = args.extension === undefined ? undefined : extensionMisfit({ type: args.type, extension: args.extension });
  if (misfit) return refused(misfit);
  if (!model.metamodel.has(args.type)) return refused(`no type '${args.type}'`);
  const made = mintTyped(model, args.type, {}, args.extension);
  return { ok: true, attributes: attributesOf(model, made), structure: structureOf(model, made) };
}

/** What BPMN declares and a schema does not re-declare, which no file writes by hand. */
const UNSET = new Set(['id', 'incoming', 'outgoing', 'extensionElements', 'extensionDefinitions', 'lanes', 'categoryValueRef', 'auditing', 'monitoring']);

/** The properties BPMN gives the element `made`, as `set` takes them: each with the concrete types it may hold. */
function structureOf(model: StudyModel, made: Element): StructureRecord[] {
  const schema = new Set(attributesOf(model, made).map((attribute) => attribute.name));
  const types = (model.metamodel.package('bpmn')?.types ?? []) as { name: string; isAbstract?: boolean }[];
  const concrete = (type: string): string[] => (type.startsWith('bpmn:')
    ? types.filter((candidate) => !candidate.isAbstract && isBpmnSubtypeOf(`bpmn:${candidate.name}`, type)).map((candidate) => candidate.name)
    : []);
  return model.metamodel.descriptor(model.host(made)).properties
    .filter((property) => property.ns?.prefix === 'bpmn' && !UNSET.has(property.name) && !schema.has(property.name))
    .map((property): StructureRecord => {
      const of = property.isReference ? [] : concrete(property.type);
      return {
        name: property.name,
        type: property.type,
        ...(property.isMany ? { many: true } : {}),
        ...(property.isReference ? { reference: true } : {}),
        ...(of.length > 1 ? { of } : {}),
      };
    });
}

/** The shape `what` makes, or why it makes none. */
export function shapeFor(what: NewElement): NewShape | string {
  if ('template' in what) return 'type' in what ? 'give a type or a template, not both' : shapeOf(what) ?? `no template '${what.template}'`;
  if (typeof what.type !== 'string') return 'give a type or a template';
  return extensionMisfit(what) ?? what;
}

/** Why `shape` cannot carry its extension, or nothing: a schema type, by its full name, that extends `shape.type`. */
export function extensionMisfit({ type, extension }: NewShape): string | undefined {
  if (extension === undefined) return undefined;
  const entry = hasCatalog() ? getCatalog().getType(extension) : undefined;
  if (!entry?.bpmnType || entry.name !== extension) return `no schema type '${extension}'`;
  return isBpmnSubtypeOf(type, entry.bpmnType) ? undefined : `a ${type} cannot be a ${extension}`;
}

/** Whether a schema, or BPMN, gives `element` the attribute `name`. */
export function declares(model: StudyModel, element: Element, name: string): boolean {
  const extension = model.extensionType(element);
  const local = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
  return !!getAttributeSpec(model.host(element), name) || !!(extension && getAttributeSpec(extension, name)) || !!model.property(element, local);
}
