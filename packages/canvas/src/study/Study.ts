/**
 * A study: the document (its BPMN definitions and the scene drawn from them), the one place it is
 * edited, its undo history, and the news of each change. It needs no DOM: a canvas is one view of a
 * study, and several views may share one.
 */

import { definitionsToStudyflow, fromWireDefinitions, looksLikeXml, metamodelOfModdle, patchDoc, readerWarning, setItemSubject, setMessageItem, studyflowToDefinitions, toWireXml } from '@core/document';
import type { YamlDoc } from '@core/document/format.ts';
import { definitionsToYamlDoc } from '@core/document/serialize.ts';
import { categoryOf, isExpandable } from '@core/document/outline.ts';
import { eventDefinitionTypeOf, getAttributeSpec, getExtensionType, setAttribute, StudyflowElement } from '@core/element/index.ts';
import { getProperty, type Moddle } from '@core/element/moddle.ts';
import { getCatalog, hasCatalog, isBpmnSubtypeOf } from '@core/notation/index.ts';
import { StudyModel, type Element } from '@core/model/index.ts';
import type { Ids } from '@core/model/items.ts';
import { readStudy, writeStudy } from '@core/model/yaml.ts';
import { attributesOf, type AttributeRecord } from '@canvas/study/attributes.ts';
import { appendSpot, freeSpot } from '@canvas/study/autoplace.ts';
import { installedCatalog, type Catalog } from '@canvas/study/catalog.ts';
import { writeDi } from '@canvas/study/di.ts';
import { draftDrawing, drawDataFlow } from '@canvas/study/draft.ts';
import { Drag, type Movable } from '@canvas/study/drag.ts';
import { containerOf, hitTest, obstaclesIn } from '@canvas/study/hit.ts';
import { History } from '@canvas/study/history.ts';
import { importDefinitions, type ImportOptions } from '@canvas/study/import.ts';
import { syncLabel } from '@canvas/study/labels.ts';
import { findById } from '@canvas/study/moddle.ts';
import { Mutator, type AddShapeSpec, type Commit } from '@canvas/study/mutator.ts';
import { layoutScene } from '@canvas/study/layout.ts';
import { rerouteEdge, rerouteEdges, routableEnd, routeFor } from '@canvas/study/orthogonal.ts';
import { defaultSizeFor, prototypeOf, shapeSpec, type CreatePrototype, type NewElement, type NewShape } from '@canvas/study/prototype.ts';
import { Rules } from '@canvas/study/rules.ts';
import { spreadEdges } from '@canvas/study/spread.ts';
import type { Bounds, Drawable, ElementColors, FontPatch, ModdleObject, Point, Scene, SceneEdge, SceneElement, SceneNode } from '@canvas/study/scene.ts';
import { recordOf, type ElementRecord } from '@canvas/study/records.ts';
import { buildTemplate, findTemplate, layOutTemplate, shapeOf } from '@canvas/study/templates.ts';
import { copyOf, fragmentOf } from '@canvas/study/clipboard.ts';
import { ASKABLE_TOOLS, isStepTool, misfitOf, STUDY_TOOLS, type ArgsOf, type StepTool, type StructureRecord, type StudyTool, type ToolName, type ToolResult } from '@canvas/study/tools.ts';
import { boundsOf, edgesAffectedBy, hostOf, isDescendantOf, planeOf } from '@canvas/study/tree.ts';
import { writerFor, type StudyWriter } from '@canvas/study/writer.ts';

/** The ids of the nodes and flows a change added, changed (the root's, when the diagram's own properties changed) and removed. */
export interface ChangedIds {
  readonly added: readonly string[];
  readonly changed: readonly string[];
  readonly removed: readonly string[];
}

/**
 * What one change did to the study, and why. An 'edit' is one commit: what it added, changed and removed. A
 * 'load', an 'undo' and a 'redo' put another document in place: what only the old one held is removed, what only
 * the new one holds added, and everything else changed, the root among it.
 */
export interface StudyChange extends ChangedIds {
  readonly cause: 'edit' | 'load' | 'undo' | 'redo';
}

export interface OpenOptions extends ImportOptions {
  /** Reads the text: a moddle over the schemas the document uses. */
  moddle: Moddle;
}

/**
 * What one verb did, as data a host or an AI reads alike: the ids of the elements it added, changed and removed,
 * or, when `ok` is false, why it wrote nothing.
 */
export interface StudyResult extends ChangedIds {
  readonly ok: boolean;
  readonly reason?: string;
  /** The element the verb made, when it made one. */
  readonly id?: string;
}

/** Whether a verb would run, and why not: what `can` answers. */
export interface Verdict {
  readonly ok: boolean;
  readonly reason?: string;
}

type ChangeListener = (change: StudyChange) => void;

/** What the canvas's views read behind a study's public surface. They write only through the study: its verbs, and
 * `settle` for what a gesture moved in place. */
export interface StudyInternals {
  readonly scene: Scene;
  /** What may connect, contain or resize what: the study's verbs and every view's gestures ask the same rules. */
  readonly rules: Rules;
  /**
   * Commit, as one edit, the geometry a gesture has already moved in the scene (`changed`), and the change of
   * container its drop makes (`rehome`): how a drag, a resize or a bend lands in the history.
   */
  settle(changed: readonly SceneElement[], rehome?: { nodes: readonly SceneNode[]; into?: SceneNode }): StudyResult;
  /**
   * Make the edits `edit` commits part of the run `key`: edits under one key, each within `RUN_WINDOW_MS` of the last,
   * are one undo step (a run of arrow-key nudges of one selection).
   */
  runAs(key: string, edit: () => void): void;
}

/** How far right and down a paste with no place lands from where its document draws it: beside what it copied. */
const PASTE_STEP = 20;

/** The study's own: its internals, and the mutator behind every write. */
interface Own extends StudyInternals {
  readonly mutator: Mutator;
}

const internals = new WeakMap<Study, Own>();

/** The scene, rules and `settle` behind `study`, for the canvas's views and gestures. The package index does not export it. */
export function studyInternals(study: Study): StudyInternals {
  return internals.get(study)!;
}

/** The mutator behind `study`: for `study/` and its specs, never a view (ESLint holds the views to the verbs). */
export function studyMutator(study: Study): Mutator {
  return internals.get(study)!.mutator;
}

function own(study: Study): Own {
  return internals.get(study)!;
}

/**
 * The document as an undo snapshot: its `.studyflow.yaml` tree as JSON rather than YAML text, which holds the same and
 * is written and read back several times faster.
 */
function snapshotOf(definitions: ModdleObject): string {
  return JSON.stringify(definitionsToYamlDoc(definitions));
}

export class Study {
  /** The tools an AI drives a study with, as MCP lists them: each a name, a description, the JSON Schema of its argument, hints. */
  static readonly tools: readonly StudyTool[] = STUDY_TOOLS;

  private readonly listeners = new Set<ChangeListener>();
  /** Changes held back while a batch runs (`atomic`). */
  private holding: StudyChange[] | undefined;
  private readonly options: ImportOptions;
  private readonly rules = new Rules();
  /** The document after each edit, as its `.studyflow.yaml` tree in JSON ({@link snapshotOf}): what undo and redo go back and forth through. */
  private readonly history: History<string>;
  /** The last commit, for the verb that made it to report. */
  private committed?: Commit;
  /** The study model of the document at a revision ({@link model}). */
  private derived?: { revision: number; model: StudyModel };

  private constructor(definitions: ModdleObject, options: ImportOptions) {
    this.options = options;
    this.read(definitions, 0);
    // As read, before any edit: the DI is the file's, so nothing is written back yet.
    this.history = new History(snapshotOf(definitions));
  }

  /** A study of `text`, a `.studyflow.yaml` or BPMN XML file. */
  static async open(text: string, options: OpenOptions): Promise<Study> {
    return new Study(await parse(text, options.moddle, options.onWarning), options);
  }

  /** A study of `definitions`, which it edits in place from here on. */
  static fromDefinitions(definitions: ModdleObject, options: ImportOptions = {}): Study {
    return new Study(definitions, options);
  }

  /** Replace the document with `source`, file text or definitions, as one change: a 'load', which the history starts over from. */
  async load(source: string | ModdleObject): Promise<void> {
    const definitions = typeof source === 'string' ? await parse(source, moddleOf(this.definitions), this.options.onWarning) : source;
    this.swap(definitions, 'load');
  }

  /** The document as a `.studyflow.yaml` file holds it: the drawing written into its DI. */
  toYaml(): string {
    const { scene } = own(this);
    writeDi(scene);
    return definitionsToStudyflow(scene.definitions);
  }

  /** The document as a BPMN XML file holds it: the drawing written into its DI, an exchange as the BPMN task it is. */
  async toXml(): Promise<string> {
    const { scene } = own(this);
    writeDi(scene);
    const moddle = moddleOf(scene.definitions);
    const { xml } = await moddle.toXML(scene.definitions, { format: true });
    return toWireXml(xml, moddle);
  }

  /**
   * The study as a study model, read off the document as it stands: a new one after each change, so an element of an
   * older one is not this study's. What reads the study holds it; what edits it goes through the verbs.
   */
  get model(): StudyModel {
    const { scene } = own(this);
    if (this.derived?.revision !== scene.revision) {
      const metamodel = metamodelOfModdle(moddleOf(scene.definitions));
      this.derived = { revision: scene.revision, model: new StudyModel(readStudy(JSON.parse(this.history.now) as YamlDoc, metamodel, () => {}), metamodel) };
    }
    return this.derived.model;
  }

  /** The element `id` names in {@link model}, drawn or not. */
  element(id: string): Element | undefined {
    return this.model.get(id);
  }

  /** The `bpmn:Definitions` the study edits: another object after a load, an undo or a redo. */
  get definitions(): ModdleObject {
    return own(this).scene.definitions;
  }

  /** The document's root, a process or a collaboration, as data: always the document's, whatever a view shows. */
  get root(): ElementRecord {
    return recordOf(own(this).scene.rootElement);
  }

  /** The element `id` names, as data: a shape, a flow, a caption, or the root. */
  get(id: string): ElementRecord | undefined {
    const { scene } = own(this);
    if (id === scene.rootElement.id) return this.root;
    const element = scene.elementsById.get(id);
    return element && recordOf(element);
  }

  /**
   * The shapes and flows, as data, in the order the document holds them: those of `kind` (captions too, with
   * 'label'), of `type` (a BPMN type or the schema type extending it), `within` a container however deep.
   */
  list(filter: { kind?: 'node' | 'edge' | 'label'; type?: string; within?: string } = {}): ElementRecord[] {
    const { scene } = own(this);
    const within = filter.within === undefined ? undefined : scene.elementsById.get(filter.within);
    if (filter.within !== undefined && within?.kind !== 'node') return [];
    return [...scene.elementsById.values()]
      .filter((element) => (filter.kind ? element.kind === filter.kind : element.kind !== 'label'))
      .filter((element) => !within || isDescendantOf(element, within as SceneNode))
      .map(recordOf)
      .filter((record) => !filter.type || record.type === filter.type || record.extension === filter.type);
  }

  /** The attributes the element `id` takes, as data: by the names `set` takes, with what each holds now. */
  attributes(id: string): AttributeRecord[] | undefined {
    const found = this.find(id);
    return found && attributesOf(found.moddle);
  }

  /** The moddle behind `id`, for in-process hosts reading what a record leaves out; not a tool. */
  businessObject(id: string): ModdleObject | undefined {
    return this.find(id)?.moddle;
  }

  /** What `add`, `append` and `replace` make, as data: the BPMN shape types, the schema types extending them, the templates. */
  catalog(): Catalog {
    const moddle = moddleOf(this.definitions);
    return installedCatalog((prefix) => moddle.getPackage(prefix) !== undefined);
  }

  /**
   * Run the tool `name` on `args`, parsed JSON, as an MCP client calls one: the argument checked against the tool's
   * schema, a write all or nothing. Answers with one JSON object; `ok` false, and why, when the tool did nothing.
   */
  call(name: string, args: unknown = {}): ToolResult {
    if (isStepTool(name)) return this.atomic(() => this.step(name, args));
    const misfit = misfitOf(name, args);
    if (misfit) return refused(misfit);
    // What passed a tool's schema is what its schema admits.
    const as = <Tool extends ToolName>(_tool: Tool): ArgsOf<Tool> => args as ArgsOf<Tool>;
    switch (name as Exclude<ToolName, StepTool>) {
      case 'document': return { ok: true, yaml: this.toYaml() };
      case 'copy': return this.copy(as('copy'));
      case 'get': {
        const { id } = as('get');
        const element = this.get(id);
        return element ? { ok: true, element } : refused(`no element '${id}'`);
      }
      case 'list': {
        const { name: part, geometry, ...filter } = as('list');
        const wanted = part?.toLowerCase();
        const found = this.list(filter).filter((element) => wanted === undefined || element.name?.toLowerCase().includes(wanted));
        return { ok: true, elements: geometry ? found : found.map(undrawn) };
      }
      case 'describe': return this.describe(as('describe'));
      case 'catalog': return { ok: true, ...this.catalog() };
      case 'can': return this.can(as('can').tool, as('can').args);
      case 'attributes': {
        const { id } = as('attributes');
        const attributes = this.attributes(id);
        return attributes ? { ok: true, attributes } : refused(`no element '${id}'`);
      }
      case 'batch': return this.batch(as('batch'));
      case 'undo': return this.undo();
      case 'redo': return this.redo();
    }
  }

  /**
   * Whether the rules let `append`, `connect` or `replace` run on `args`, without writing, and why not: what a menu asks
   * before it offers an entry. Leave out what is not decided yet to ask about any: `can('append', { from })` asks
   * whether anything may follow `from`, `can('connect', { from })` whether a flow may leave it, `can('replace', { id })`
   * whether it may be retyped at all.
   */
  can(tool: StepTool, args: Record<string, unknown>): Verdict {
    if (!(ASKABLE_TOOLS as readonly string[]).includes(tool)) {
      // Any other write is asked by running it on a copy of the document, which is then let go.
      const copy = Study.fromDefinitions(studyflowToDefinitions(JSON.parse(this.history.now) as YamlDoc, moddleOf(this.definitions), () => {}), this.options);
      const outcome = copy.call(tool, args);
      return outcome.ok ? { ok: true } : { ok: false, reason: (outcome as Verdict).reason };
    }
    const checked = misfitOf(tool, args, ['to', 'type'])
      ?? (tool === 'append' ? this.appending(args as never) : tool === 'connect' ? this.connecting(args as never) : this.replacing(args as never));
    return typeof checked === 'string' ? { ok: false, reason: checked } : { ok: true };
  }

  /**
   * What an element of `type` takes, before one exists: its schema's attributes (with `extension`, that schema
   * type's too), and the properties BPMN gives it, which `set` takes as the file spells them.
   */
  describe(args: { type: string; extension?: string }): ToolResult {
    const model = moddleOf(this.definitions);
    const misfit = args.extension === undefined ? undefined : extensionMisfit({ type: args.type, extension: args.extension } as NewShape);
    if (misfit) return refused(misfit);
    let made: ModdleObject;
    try {
      made = model.create(args.type, {}) as ModdleObject;
    } catch {
      return refused(`no type '${args.type}'`);
    }
    if (args.extension) StudyflowElement.fromBusinessObject(made).ensureExtension(args.extension, model, {});
    return { ok: true, attributes: attributesOf(made), structure: structureOf(made, model) };
  }

  /**
   * Say what the message flow `id` carries, or what the property or data object `id` holds: the item definition of
   * `structure`, which the document keeps one of, made on first use. An empty `structure` says nothing of it.
   */
  item({ id, structure }: { id: string; structure: string }): StudyResult {
    const found = this.find(id);
    if (!found) return refused(`no element '${id}'`);
    const { moddle } = found;
    const carries = moddle.$type === 'bpmn:MessageFlow';
    if (!carries && !(moddle.$descriptor as { propertiesByName?: Record<string, unknown> })?.propertiesByName?.itemSubjectRef) {
      return refused(`'${id}' is no message flow, property or data object: it holds no item`);
    }
    return this.write(found.drawn, (writer) => (carries ? setMessageItem : setItemSubject)(writer, this.definitions, moddle, structure.trim()));
  }

  /** Goes up by one on every change. */
  get revision(): number {
    return own(this).scene.revision;
  }

  /**
   * Set `attribute` on the element `id` names, where its schema keeps it (core's `setAttribute`); 'name' renames. An
   * attribute neither a schema nor BPMN gives the element is refused, never written as a stray. A structured value
   * (a loop marker, an event's definitions, a scope's properties, the data a step reads) or a reference (a gateway's
   * `default`) is given as the `.studyflow.yaml` file spells it, and read as the file is.
   */
  set({ id, attribute, value }: { id: string; attribute: string; value: unknown }): StudyResult {
    const found = this.find(id);
    if (!found) return refused(`no element '${id}'`);
    if (!declares(found.moddle, attribute)) return refused(`no schema gives '${id}' an attribute '${attribute}'`);
    const property = (found.moddle.$descriptor as { propertiesByName?: Record<string, { isReference?: boolean }> } | undefined)?.propertiesByName?.[attribute];
    // What BPMN keeps as an element or a reference is written as the file spells it, and cleared by taking it out;
    // text kept in an element of its own (an expression, the documentation) is written in place, as it is typed.
    const held = [found.moddle[attribute]].flat()[0] as ModdleObject | undefined;
    const text = typeof held?.$instanceOf === 'function' && (held.$instanceOf('bpmn:Expression') || held.$instanceOf('bpmn:Documentation'));
    const structured = property?.isReference || (typeof held === 'object' && held !== null && !text);
    if (value === null ? structured : typeof value === 'object' || property?.isReference) return this.spell(found.moddle, attribute, value, found.drawn?.id ?? this.root.id);
    // Typing into one attribute is one undo step, however many keystrokes wrote it.
    return this.within(`set:${id}:${attribute}`, () => this.write(found.drawn, (writer) => setAttribute(found.moddle, attribute, value, writer)));
  }

  /**
   * Write `attribute` of `moddle` as the file spells `value`: the document's tree with that one key changed, read
   * back whole, so what the value names (a flow, a property, a data object) is what the document holds. One undo
   * step, reported on `about`. Refused, and nothing changed, when the reader cannot place something in it.
   */
  private spell(moddle: ModdleObject, attribute: string, value: unknown, about: string): StudyResult {
    const model = moddleOf(this.definitions);
    const read = (doc: YamlDoc): { definitions: ModdleObject; warnings: string[] } => {
      const warnings: string[] = [];
      return { definitions: studyflowToDefinitions(doc, model, (warning) => warnings.push(warning)), warnings };
    };
    const doc = JSON.parse(this.history.now) as YamlDoc;
    const known = new Set(read(JSON.parse(this.history.now) as YamlDoc).warnings);
    if (!patchDoc(doc, moddle, attribute, value)) return refused(`'${attribute}' of '${moddle.id}' is not written this way: edit it in the document`);
    let patched: ReturnType<typeof read>;
    try {
      patched = read(doc);
    } catch (error) {
      return refused(error instanceof Error ? error.message : String(error));
    }
    const misread = patched.warnings.find((warning) => !known.has(warning));
    if (misread) return refused(misread);
    this.history.push(snapshotOf(patched.definitions));
    // Heard as a redo is: another document in place of the one it held, which every view reads afresh. The caller is
    // told what it wrote.
    this.swap(patched.definitions, 'redo');
    return { ok: true, added: [], changed: [about], removed: [] };
  }

  /**
   * Rename the element `id` names, as its caption reads; `band` renames instead the participant a choreography task's
   * `top` or `bottom` band shows. One edit; an empty name clears it.
   */
  rename(args: { id: string; name: string; band?: 'top' | 'bottom' }): StudyResult {
    const { scene, mutator } = own(this);
    const element = scene.elementsById.get(args.id);
    if (!element || element.kind === 'label') return refused(`no shape or flow '${args.id}'`);
    if (args.band && element.kind !== 'node') return refused(`'${args.id}' is a flow: it has no bands`);
    return this.commit(() => {
      if (args.band && element.kind === 'node') mutator.setBandName(element, args.band, args.name.trim());
      else mutator.setName(element, args.name.trim());
    });
  }

  /**
   * Write the moddle behind `id` in place, as one commit: for what `set` cannot spell. Edits naming the same `run`
   * (a field being typed into) one after another are one undo step. In-process only, not a tool.
   */
  edit(id: string, write: (writer: StudyWriter) => void, run?: string): StudyResult {
    const found = this.find(id);
    if (!found) return refused(`no element '${id}'`);
    const commit = () => this.write(found.drawn, write);
    return run === undefined ? commit() : this.within(`edit:${id}:${run}`, commit);
  }

  /**
   * Write the element `id` names in the study model, as one commit: `write` changes a copy of {@link model}, which is
   * read back whole, as `set` reads a value the file spells. Edits naming the same `run` one after another are one
   * undo step. Refused, and nothing changed, when the reader cannot place what was written. In-process only, not a tool.
   */
  revise(id: string, write: (element: Element, model: StudyModel, ids: Ids) => void, run?: string): StudyResult {
    const before = this.model;
    const metamodel = before.metamodel;
    const copy = new StudyModel(readStudy(JSON.parse(this.history.now) as YamlDoc, metamodel, () => {}), metamodel);
    const element = copy.get(id);
    if (!element) return refused(`no element '${id}'`);
    const unwritten = JSON.stringify(copy.study);
    const { ids } = own(this).mutator;
    write(element, copy, {
      next: (prefix) => ids.nextPrefixed(prefix),
      free: (base) => {
        let free = base;
        for (let n = 2; ids.assigned(free); n += 1) free = `${base}_${n}`;
        ids.claim(free);
        return free;
      },
    });
    if (JSON.stringify(copy.study) === unwritten) return { ok: true, ...NOTHING };
    copy.reindex();
    const moddle = moddleOf(this.definitions);
    const warnings = (doc: YamlDoc): { definitions: ModdleObject; warnings: Set<string> } => {
      const heard = new Set<string>();
      return { definitions: studyflowToDefinitions(doc, moddle, (warning) => heard.add(warning)), warnings: heard };
    };
    const known = warnings(JSON.parse(this.history.now) as YamlDoc).warnings;
    let revised: ReturnType<typeof warnings>;
    try {
      revised = warnings(writeStudy(copy.study, metamodel));
    } catch (error) {
      return refused(error instanceof Error ? error.message : String(error));
    }
    const misread = [...revised.warnings].find((warning) => !known.has(warning));
    if (misread) return refused(misread);
    const scene = this.read(revised.definitions, own(this).scene.revision + 1);
    const snapshot = snapshotOf(scene.definitions);
    if (run === undefined) this.history.push(snapshot);
    else this.history.runAs(`revise:${id}:${run}`, () => this.history.record(snapshot));
    const change = { cause: 'edit' as const, ...revisedIds(before, this.model) };
    this.announce(change);
    return { ok: true, ...change };
  }

  /**
   * Add `what` centred on `at` (without it, beside the shapes it joins), into the container `into` names (the root's
   * id for the top level; without one, whatever is under `at`). `id` names it, when free; a template keeps its own.
   */
  add(args: NewElement & { id?: string; at?: Point; into?: string }): StudyResult {
    const { scene, rules } = own(this);
    const shape = shapeFor(args);
    if (typeof shape === 'string') return refused(shape);
    if (this.taken(args.id)) return refused(`the id '${args.id}' is taken`);
    const top = args.into === undefined || args.into === scene.rootElement.id;
    const named = top ? undefined : scene.elementsById.get(args.into!);
    if (!top && named?.kind !== 'node') return refused(`no container '${args.into}'`);
    const container = named?.kind === 'node' ? named : args.into === undefined && args.at ? containerOf(hitTest(scene, args.at)) : undefined;
    const prototype = prototypeOf(shape);
    // A container named by id takes what fits in it however it is drawn; one found under `at` only when drawn open.
    const context = named?.kind === 'node' ? { ...named, isExpanded: true } : container ?? scene.rootElement;
    const verdict = rules.canCreate(prototype, context, { root: scene.rootElement });
    if (!verdict) return refused(`a ${shape.type} cannot go ${container ? `into '${container.id}'` : 'at the top level'}`);
    const at = args.at ?? freeSpot(scene, container, prototype, prototype.type);
    const place = verdict === 'attach' && container ? { attachTo: container } : container ? { parent: container } : {};
    return this.commit(() => this.drop(args, prototype, at, place));
  }

  /** Add `what` beside `from` and connect the two, as one edit: one gap to its right, clear of what shares its plane. */
  append(args: NewElement & { from: string; id?: string }): StudyResult {
    const { scene } = own(this);
    const checked = this.appending(args);
    if (typeof checked === 'string') return refused(checked);
    const { source, shape } = checked;
    if (!shape) return refused('give a type or a template');
    if (this.taken(args.id)) return refused(`the id '${args.id}' is taken`);
    const prototype = prototypeOf(shape);
    const at = appendSpot(scene, source, prototype, prototype.type);
    return this.commit(() => {
      const node = this.drop(args, prototype, at, source.parent ? { parent: source.parent } : {});
      this.link(source, node);
      return node;
    });
  }

  /** Connect `from` to `to` with what the rules allow between them: a sequence or message flow, a data or plain association. */
  connect(args: { from: string; to: string; id?: string }): StudyResult {
    const checked = this.connecting(args);
    if (typeof checked === 'string') return refused(checked);
    const { source, target } = checked;
    if (!target) return refused(`no shape '${args.to}'`);
    if (this.taken(args.id)) return refused(`the id '${args.id}' is taken`);
    return this.commit(() => this.link(source, target, args.id));
  }

  /** Retype `id` in place as `what`: a new shape in its stead, keeping its name, its centre and its flows, as one edit. */
  replace(args: NewShape & { id: string }): StudyResult {
    const { scene, mutator } = own(this);
    const checked = this.replacing(args);
    if (typeof checked === 'string') return refused(checked);
    const { node, prototype } = checked;
    if (!prototype) return refused('give a type');
    if (prototype.type === node.type && prototype.extensionType === getExtensionType(node.businessObject)
      && eventDefinitionTypeOf(prototype.attrs as never) === eventDefinitionTypeOf(node.businessObject)) {
      return { ok: true, id: node.id, ...NOTHING };
    }
    const size = categoryOf(prototype.type) === categoryOf(node.type)
      ? { width: node.width, height: node.height }
      : defaultSizeFor(prototype.type, prototype.isExpanded);
    const name = getProperty(node.businessObject, 'name');
    const attrs = { ...prototype.attrs, ...(typeof name === 'string' && name ? { name } : {}) };
    const spec: AddShapeSpec = {
      ...shapeSpec({ ...prototype, ...size }, { x: node.x + node.width / 2, y: node.y + node.height / 2 }),
      ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
      ...(node.parent ? { parent: node.parent } : {}),
    };
    return this.commit(() => {
      const shape = mutator.addShape(spec);
      for (const edge of [...node.incoming]) mutator.reconnect(edge, { target: shape });
      for (const edge of [...node.outgoing]) mutator.reconnect(edge, { source: shape });
      mutator.deleteElements([node]);
      mutator.commit(rerouteEdges(edgesAffectedBy([shape]), { obstacles: obstaclesIn(scene, planeOf(shape)) }));
      return shape;
    });
  }

  /**
   * Move the shapes and captions `ids` names by `by`, in diagram units, their contents and flows along, the flows
   * routed afresh; into the container `into` names (the root's id for the top level) when given, as the rules allow.
   * One edit.
   */
  move(args: { ids: string[]; by: Point; into?: string }): StudyResult {
    const { scene, mutator, rules } = own(this);
    const found = this.elements(args.ids);
    if (typeof found === 'string') return refused(`no element '${found}'`);
    const flow = found.find((element) => element.kind === 'edge');
    if (flow) return refused(`'${flow.id}' is a flow: it moves with its ends, and reroute moves its route`);
    const movable = found as Movable[];
    const nodes = movable.filter((element): element is SceneNode => element.kind === 'node');
    // The shapes that move by themselves: not those inside another that moves.
    const roots = nodes.filter((node) => !nodes.some((other) => other !== node && isDescendantOf(node, other)));
    const top = args.into === scene.rootElement.id;
    const named = args.into === undefined || top ? undefined : scene.elementsById.get(args.into);
    if (args.into !== undefined && !top && named?.kind !== 'node') return refused(`no container '${args.into}'`);
    const into = named?.kind === 'node' ? named : undefined;
    // A container named by id takes what fits in it however it is drawn, as with `add`.
    if (args.into !== undefined && !rules.canMove(roots, into ? { ...into, isExpanded: true } : scene.rootElement)) {
      return refused(`${roots.map((node) => `'${node.id}'`).join(', ')} cannot go ${into ? `into '${into.id}'` : 'to the top level'}`);
    }
    const drag = new Drag({
      settle: (changed) => {
        mutator.commit([...changed]);
        return { ok: true, added: [], changed: [], removed: [] };
      },
      rules,
      redraw: () => {},
      getScene: () => scene,
      getScope: () => undefined,
      hitTest: () => undefined,
      obstacles: (moving) => obstaclesIn(scene, moving[0] && planeOf(moving[0]), moving),
    });
    return this.commit(() => {
      if (!drag.startMove(movable, { x: 0, y: 0 }, { snapToGrid: false })) return;
      drag.end(args.by);
      const rehomed = args.into === undefined ? [] : roots.filter((node) => node.parent !== into);
      if (rehomed.length > 0) mutator.reparent(rehomed, into);
    });
  }

  /** Move the ends of the flow `id` onto other shapes, `from` and `to`, as the rules allow its kind of flow; routed afresh, one edit. */
  reconnect(args: { id: string; from?: string; to?: string; waypoints?: Point[] }): StudyResult {
    const { scene, mutator, rules } = own(this);
    const edge = scene.elementsById.get(args.id);
    if (edge?.kind !== 'edge') return refused(`no flow '${args.id}'`);
    if (args.from === undefined && args.to === undefined) return refused('give the new end: from, to, or both');
    const source = args.from === undefined ? edge.source : scene.elementsById.get(args.from);
    const target = args.to === undefined ? edge.target : scene.elementsById.get(args.to);
    if (source?.kind !== 'node') return refused(`no shape '${args.from ?? edge.source?.id}'`);
    if (target?.kind !== 'node') return refused(`no shape '${args.to ?? edge.target?.id}'`);
    if (!rules.canReconnect(edge, source, target)) return refused(`a ${edge.type} cannot run from '${source.id}' to '${target.id}'`);
    return this.commit(() => {
      mutator.reconnect(edge, { source, target }, args.waypoints ?? routeFor(edge.type, source, target));
    });
  }

  /** Give the shape `id` new bounds, as one edit. */
  resize(args: { id: string; bounds: Bounds }): StudyResult {
    const { scene, mutator, rules } = own(this);
    const node = scene.elementsById.get(args.id);
    if (node?.kind !== 'node') return refused(`no shape '${args.id}'`);
    if (!rules.canResize(node)) return refused(`'${args.id}' keeps its size`);
    return this.commit(() => {
      mutator.setNodeBounds(node, args.bounds);
    });
  }

  /** Route the flow `id` through `waypoints`, or squarely between its ends without them, as one edit. */
  reroute(args: { id: string; waypoints?: Point[] }): StudyResult {
    const { scene, mutator } = own(this);
    const edge = scene.elementsById.get(args.id);
    if (edge?.kind !== 'edge') return refused(`no flow '${args.id}'`);
    const { waypoints } = args;
    if (waypoints && waypoints.length < 2) return refused('a route runs through two waypoints at least');
    return this.commit(() => {
      if (waypoints) mutator.setEdgeWaypoints(edge, waypoints);
      else mutator.commit(rerouteEdges([edge], { obstacles: obstaclesIn(scene, planeOf(edge)) }));
    });
  }

  /**
   * Lay the whole diagram out afresh (`study/layout.ts`): each flow left to right, lanes as bands, pools stacked, data
   * under its steps, groups round what they hold. Shapes keep their sizes, and every flow is routed anew. One edit.
   */
  layout(_args: Record<string, never> = {}): StudyResult {
    const { scene, mutator } = own(this);
    return this.commit(() => mutator.commit(layOut(scene)));
  }

  /**
   * The shapes `ids` name, with what they hold, the boundary events on them and the flows between them, as a
   * `.studyflow.yaml` document of their own: what `paste` takes. A read.
   */
  copy(args: { ids: string[] }): { ok: true; yaml: string } | { ok: false; reason: string } {
    const found = this.elements(args.ids);
    if (typeof found === 'string') return { ok: false, reason: `no element '${found}'` };
    const yaml = copyOf(own(this).scene, args.ids);
    return yaml === undefined ? { ok: false, reason: 'nothing to copy: pools, lanes and a flow without its ends stay behind' } : { ok: true, yaml };
  }

  /**
   * Draw the shapes and flows of `yaml`, a `.studyflow.yaml` document's process (what `copy` gives), as one edit:
   * centred on `at`, or without it a step right of and below where the document draws them; into the container
   * `into` names (the root's id for the top level; without one, whatever is under `at`). An id the study holds is
   * swapped for a fresh one, and code naming it follows.
   */
  paste(args: { yaml: string; at?: Point; into?: string }): StudyResult {
    const { scene, rules, mutator } = own(this);
    const top = args.into === undefined || args.into === scene.rootElement.id;
    const named = top ? undefined : scene.elementsById.get(args.into!);
    if (!top && named?.kind !== 'node') return refused(`no container '${args.into}'`);
    const container = named?.kind === 'node' ? named : args.into === undefined && args.at ? containerOf(hitTest(scene, args.at)) : undefined;
    const fragment = fragmentOf(args.yaml, scene.definitions, mutator.ids);
    if (typeof fragment === 'string') return refused(fragment);
    const shapes = fragment.rootElement.children.filter((element): element is SceneNode => element.kind === 'node');
    const context = named?.kind === 'node' ? { ...named, isExpanded: true } : container ?? scene.rootElement;
    const misfit = shapes.find((shape) => !hostOf(fragment, shape) && !rules.canCreate(shape, context, { root: scene.rootElement }));
    if (misfit) return refused(`a ${misfit.type} cannot go ${container ? `into '${container.id}'` : 'at the top level'}`);
    const box = boundsOf(shapes)!;
    const by = args.at
      ? { x: Math.round(args.at.x - box.x - box.width / 2), y: Math.round(args.at.y - box.y - box.height / 2) }
      : { x: PASTE_STEP, y: PASTE_STEP };
    return this.commit(() => mutator.graft(fragment, container, by));
  }

  /** Remove `ids` and all that goes with them (contents, flows), as one edit; a caption's id clears the name it shows. */
  remove(args: { ids: string[] }): StudyResult {
    const { mutator } = own(this);
    const found = this.elements(args.ids);
    if (typeof found === 'string') return refused(`no element '${found}'`);
    const drawables = found.filter((element): element is Drawable => element.kind !== 'label');
    return this.commit(() => {
      for (const label of found) {
        if (label.kind === 'label' && !drawables.includes(label.owner)) mutator.setName(label.owner, '');
      }
      if (drawables.length > 0) mutator.deleteElements(drawables);
    });
  }

  /**
   * Colour and letter `ids`, as one edit: `fill` and `stroke` a CSS colour, `null` for the stock one; `font` the
   * caption's look (`bold`, `italic`, `align`, `color`). What is left out stays as it is; a caption styles what it captions.
   */
  style(args: { ids: string[]; fill?: string | null; stroke?: string | null; font?: FontPatch }): StudyResult {
    const { mutator } = own(this);
    const found = this.elements(args.ids);
    if (typeof found === 'string') return refused(`no element '${found}'`);
    const colors: ElementColors = {};
    if ('fill' in args) colors.fill = args.fill;
    if ('stroke' in args) colors.stroke = args.stroke;
    return this.commit(() => {
      if (Object.keys(colors).length > 0) mutator.setColor(found, colors);
      if (args.font) mutator.setFont(found, args.font);
    });
  }

  /** Draw the container `id` open, its contents framed inside it, as one edit. */
  expand(args: { id: string }): StudyResult {
    return this.open(args.id, true);
  }

  /** Draw the container `id` closed, its contents hidden until a view drills in, as one edit. */
  collapse(args: { id: string }): StudyResult {
    return this.open(args.id, false);
  }

  /**
   * Run `steps`, each a verb by name and its argument, as one edit and one undo step, all or nothing: a refused step
   * takes back those before it, and the result says which step, and why.
   */
  batch(args: { steps: { tool: string; args: unknown }[] }): StudyResult {
    return this.atomic(() => {
      for (const [index, step] of args.steps.entries()) {
        const outcome = this.step(step.tool, step.args);
        if (!outcome.ok) return refused(`step ${index + 1} (${step.tool}): ${outcome.reason}`);
      }
      return { ok: true, ...NOTHING };
    });
  }

  /** Go back to the document before the last edit, as one change of the whole, by id. */
  undo(): StudyResult {
    return this.travel(-1) ?? refused('nothing to undo');
  }

  /** Go forward to the edit the last undo went back from, as one change of the whole, by id. */
  redo(): StudyResult {
    return this.travel(1) ?? refused('nothing to redo');
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  /** Hear each change, once, in the order listeners subscribed; the returned function unsubscribes. */
  on(_event: 'change', listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Edit `definitions` from here on, in the form the canvas edits (as a file opens), and return their scene. */
  private read(definitions: ModdleObject, revision: number): Scene {
    fromWireDefinitions(definitions, this.options.onWarning);
    // A document with no drawing is drawn as it is read, and laid out; a drawn one gets the data flow it leaves out.
    const drafted = draftDrawing(definitions);
    if (!drafted) drawDataFlow(definitions);
    const scene = importDefinitions(definitions, this.options);
    if (drafted) {
      for (const element of layOut(scene)) if (element.kind !== 'label') syncLabel(scene, element);
      writeDi(scene);
    }
    scene.revision = revision;
    const mutator = new Mutator(scene, (commit) => this.edited(commit));
    internals.set(this, {
      scene,
      mutator,
      rules: this.rules,
      runAs: (key, edit) => this.history.runAs(key, edit),
      settle: (changed, rehome) => this.commit(() => {
        mutator.commit([...changed]);
        if (rehome && rehome.nodes.length > 0) mutator.reparent([...rehome.nodes], rehome.into);
      }),
    });
    return scene;
  }

  /**
   * The element `id` names, and the moddle behind it: a drawn one (a caption stands for what it captions), the root,
   * or anything else the document holds, which is not drawn.
   */
  private find(id: string): { drawn?: Drawable; moddle: ModdleObject } | undefined {
    const { scene } = own(this);
    if (id === scene.rootElement.id) return { moddle: scene.rootElement.businessObject };
    const element = scene.elementsById.get(id);
    if (element) {
      const drawn = element.kind === 'label' ? element.owner : element;
      return { drawn, moddle: drawn.businessObject };
    }
    const moddle = findById(scene.definitions, id);
    return moddle && { moddle };
  }

  /** Run `write` as one commit about `drawn` (the root, without it), and say what it did by id. */
  private write(drawn: Drawable | undefined, write: (writer: StudyWriter) => void): StudyResult {
    const { scene, mutator } = own(this);
    return this.commit(() => write(writerFor(scene, mutator, drawn)));
  }

  /** Run `edit` as one commit, and say what it did by id: `id` is the element it made, when it returns one. */
  private commit(edit: () => Drawable | undefined | void): StudyResult {
    const { mutator } = own(this);
    this.takeCommitted();
    const made = mutator.batch(edit);
    const commit = this.takeCommitted();
    return { ok: true, ...(made ? { id: made.id } : {}), ...(commit ? idsOf(commit) : NOTHING) };
  }

  /** The elements `ids` name, or the first id that names none. */
  private elements(ids: readonly string[]): SceneElement[] | string {
    const { scene } = own(this);
    const found: SceneElement[] = [];
    for (const id of ids) {
      const element = scene.elementsById.get(id);
      if (!element) return id;
      found.push(element);
    }
    return found;
  }

  private open(id: string, expanded: boolean): StudyResult {
    const { scene, mutator } = own(this);
    const node = scene.elementsById.get(id);
    if (node?.kind !== 'node' || !isExpandable(node.type)) return refused(`'${id}' holds no contents to ${expanded ? 'show' : 'hide'}`);
    return this.commit(() => {
      mutator.setExpanded(node, expanded);
    });
  }

  /** What `append` would join, or why it would refuse; without a shape or a template, whether anything may follow `from`. */
  private appending(args: { from: string } & Partial<NewShape> & { template?: string }): { source: Drawable; shape?: NewShape } | string {
    const { scene, rules } = own(this);
    const source = scene.elementsById.get(args.from);
    if (!source || source.kind === 'label') return `no element '${args.from}'`;
    const shape = 'type' in args || 'template' in args ? shapeFor(args as NewElement) : undefined;
    if (typeof shape === 'string') return shape;
    if (!rules.canAppendType(source, shape?.type)) return shape ? `nothing appends a ${shape.type} to '${args.from}'` : `nothing follows '${args.from}'`;
    return { source, ...(shape ? { shape } : {}) };
  }

  /** What `connect` would join, or why it would refuse; without `to`, whether any flow may leave `from`. */
  private connecting(args: { from: string; to?: string }): { source: Drawable; target?: SceneNode } | string {
    const { scene, rules } = own(this);
    const source = scene.elementsById.get(args.from);
    if (!source || source.kind === 'label') return `no element '${args.from}'`;
    if (args.to === undefined) return rules.canStartConnection(source) ? { source } : `nothing leaves '${args.from}'`;
    const target = scene.elementsById.get(args.to);
    if (target?.kind !== 'node') return `no shape '${args.to}'`;
    return rules.canConnect(source, target) ? { source, target } : `nothing connects '${args.from}' to '${args.to}'`;
  }

  /** What `replace` would retype, and into what, or why it would refuse; without `type`, whether `id` may be retyped at all. */
  private replacing(args: { id: string } & Partial<NewShape>): { node: SceneNode; prototype?: CreatePrototype } | string {
    const { scene, rules } = own(this);
    const node = scene.elementsById.get(args.id);
    if (node?.kind !== 'node') return `no shape '${args.id}'`;
    if (args.type === undefined) return rules.canReplace(node) ? { node } : `'${args.id}' cannot be retyped`;
    const misfit = extensionMisfit(args as NewShape);
    if (misfit) return misfit;
    const prototype = prototypeOf(args as NewShape);
    return rules.canReplace(node, prototype.type) ? { node, prototype } : `'${args.id}' cannot become a ${args.type}`;
  }

  /** Run `run` as one commit, all or nothing: when it is refused, what it wrote first is taken back. */
  private atomic(run: () => StudyResult): StudyResult {
    const before = this.history.now;
    let outcome = refused('nothing ran');
    // Held while the steps run: listeners hear the edit once it stands, or, when a step is refused, only that the
    // study went back to where it was, so a refused batch draws once.
    const held: StudyChange[] = [];
    this.holding = held;
    let result: StudyResult;
    try {
      result = this.commit(() => {
        outcome = run();
      });
    } finally {
      this.holding = undefined;
    }
    if (outcome.ok) {
      for (const change of held) this.announce(change);
      return { ...result, ...(outcome.id ? { id: outcome.id } : {}) };
    }
    if (this.history.now !== before) {
      this.travel(-1);
      this.history.truncate();
    }
    return outcome;
  }

  /** A write tool as a batch runs it: on `args` checked against the tool's schema; one that throws is refused. */
  private step(tool: string, args: unknown): StudyResult {
    const misfit = misfitOf(tool, args);
    if (misfit) return refused(misfit);
    if (!isStepTool(tool)) return refused(`a batch runs no '${tool}'`);
    // Each verb takes what its tool's schema admits, or this does not compile. A new element is the one the schema
    // says less of than the verb asks: one with neither a `type` nor a `template` is refused when it is made.
    const verbs: { [Tool in StepTool]: (args: ArgsOf<Tool>) => StudyResult } = {
      add: (a) => this.add(a as ArgsOf<'add'> & NewElement),
      append: (a) => this.append(a as ArgsOf<'append'> & NewElement),
      connect: (a) => this.connect(a),
      replace: (a) => this.replace(a),
      move: (a) => this.move(a),
      reconnect: (a) => this.reconnect(a),
      rename: (a) => this.rename(a),
      resize: (a) => this.resize(a),
      reroute: (a) => this.reroute(a),
      paste: (a) => this.paste(a),
      layout: () => this.layout(),
      set: (a) => this.set(a),
      item: (a) => this.item(a),
      remove: (a) => this.remove(a),
      style: (a) => this.style(a),
      expand: (a) => this.expand(a),
      collapse: (a) => this.collapse(a),
    };
    try {
      return (verbs[tool] as (args: unknown) => StudyResult)(args);
    } catch (error) {
      return refused(error instanceof Error ? error.message : String(error));
    }
  }

  /** Whether `id` names an element the document already holds. */
  private taken(id: string | undefined): boolean {
    return id !== undefined && own(this).mutator.ids.assigned(id);
  }

  /** Mint `what`, whose prototype is `prototype`, centred on `at` in `place`: a template lays its elements out inside. */
  private drop(what: NewElement & { id?: string }, prototype: CreatePrototype, at: Point, place: Pick<AddShapeSpec, 'parent' | 'attachTo'>): SceneNode {
    const { scene, mutator, rules } = own(this);
    const template = 'template' in what ? findTemplate(what.template) : undefined;
    if (!template) return mutator.addShape({ ...shapeSpec(prototype, at, what.id), ...place });
    const build = buildTemplate(template, scene.definitions, mutator.ids);
    const node = mutator.addShape({ ...shapeSpec(prototype, at), type: build.root.$type, businessObject: build.root, ...place });
    layOutTemplate(mutator, rules, node, build);
    return node;
  }

  /** Connect `source` to `target`, routed, as the rules allow; nothing when they refuse. */
  private link(source: SceneNode | SceneEdge, target: SceneNode, id?: string): SceneEdge | undefined {
    const { mutator, rules } = own(this);
    const spec = rules.canConnect(source, target);
    if (!spec) return undefined;
    return mutator.addConnection({ type: spec.type, source, target, waypoints: routeFor(spec.type, routableEnd(source), target), ...(id ? { id } : {}) });
  }

  /** The commit made since the last take: none when nothing was written, or when a batch around this one is still open. */
  private takeCommitted(): Commit | undefined {
    const commit = this.committed;
    this.committed = undefined;
    return commit;
  }

  /** `edit` as part of the run `key`, answering what it did. */
  private within(key: string, edit: () => StudyResult): StudyResult {
    let result: StudyResult | undefined;
    this.history.runAs(key, () => {
      result = edit();
    });
    return result!;
  }

  /** A commit: the document as it now stands goes into the history. */
  private edited(commit: Commit): void {
    this.committed = commit;
    const { scene } = own(this);
    writeDi(scene);
    this.history.record(snapshotOf(scene.definitions));
    this.announce({ cause: 'edit', ...idsOf(commit) });
  }

  /** Step through the history: what the step changed, or nothing past either end. */
  private travel(step: -1 | 1): StudyResult | undefined {
    const snapshot = this.history.travel(step);
    if (snapshot === undefined) return undefined;
    const definitions = studyflowToDefinitions(JSON.parse(snapshot) as YamlDoc, moddleOf(this.definitions), this.options.onWarning);
    return { ok: true, ...this.swap(definitions, step < 0 ? 'undo' : 'redo') };
  }

  /** Put `definitions` in place of the document, as one change; a load starts the history over. */
  private swap(definitions: ModdleObject, cause: 'load' | 'undo' | 'redo'): ChangedIds {
    const before = own(this).scene;
    const after = this.read(definitions, before.revision + 1);
    if (cause === 'load') this.history.reset(snapshotOf(definitions));
    const change = idsOf(byId(before, after));
    this.announce({ cause, ...change });
    return change;
  }

  private announce(change: StudyChange): void {
    if (this.holding) {
      this.holding.push(change);
      return;
    }
    for (const listener of [...this.listeners]) listener(change);
  }
}

const NOTHING: ChangedIds = { added: [], changed: [], removed: [] };

/** A record without where it is drawn: what an element is, and how it connects. */
function undrawn({ bounds: _bounds, waypoints: _waypoints, fill: _fill, stroke: _stroke, font: _font, pinned: _pinned, ...what }: ElementRecord): ElementRecord {
  return what;
}

/** What BPMN declares and a schema does not re-declare, which no document writes by hand. */
const UNSET = new Set(['id', 'incoming', 'outgoing', 'extensionElements', 'extensionDefinitions', 'lanes', 'categoryValueRef', 'auditing', 'monitoring']);

/** The properties BPMN gives the element `made`, as `set` takes them: each with the concrete types it may hold. */
function structureOf(made: ModdleObject, model: Moddle): StructureRecord[] {
  const schema = new Set(attributesOf(made).map((attribute) => attribute.name));
  const types: { name: string; isAbstract?: boolean }[] = model.getPackage('bpmn')?.types ?? [];
  const concrete = (type: string): string[] => (type.startsWith('bpmn:')
    ? types.filter((candidate) => !candidate.isAbstract && isBpmnSubtypeOf(`bpmn:${candidate.name}`, type)).map((candidate) => candidate.name)
    : []);
  const properties = ((made.$descriptor as { properties?: { name: string; type: string; isMany?: boolean; isReference?: boolean; ns?: { prefix?: string; localName?: string } }[] }).properties ?? []);
  return properties
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

function refused(reason: string): StudyResult {
  return { ok: false, reason, ...NOTHING };
}

/** The shape `what` makes, or why it makes none. */
function shapeFor(what: NewElement): NewShape | string {
  if ('template' in what) return 'type' in what ? 'give a type or a template, not both' : shapeOf(what) ?? `no template '${what.template}'`;
  if (typeof what.type !== 'string') return 'give a type or a template';
  return extensionMisfit(what) ?? what;
}

/** Why `shape` cannot carry its extension, or nothing: a schema type, by its full name, that extends `shape.type`. */
function extensionMisfit({ type, extension }: NewShape): string | undefined {
  if (extension === undefined) return undefined;
  const entry = hasCatalog() ? getCatalog().getType(extension) : undefined;
  if (!entry?.bpmnType || entry.name !== extension) return `no schema type '${extension}'`;
  return isBpmnSubtypeOf(type, entry.bpmnType) ? undefined : `a ${type} cannot be a ${extension}`;
}

/** Whether a schema, or BPMN, gives the element behind `moddle` the attribute `name`. */
function declares(moddle: ModdleObject, name: string): boolean {
  const element = StudyflowElement.fromBusinessObject(moddle);
  const extension = element.extension;
  const descriptor = moddle.$descriptor as { propertiesByName?: Record<string, unknown> } | undefined;
  return !!element.attribute(name) || !!(extension && getAttributeSpec(extension, name)) || !!descriptor?.propertiesByName?.[name];
}

function idsOf({ added, changed, removed }: Commit): ChangedIds {
  const ids = (elements: readonly { id: string }[]): string[] => elements.map((element) => element.id);
  return { added: ids(added), changed: ids(changed), removed: ids(removed) };
}

/** File text, `.studyflow.yaml` or BPMN XML, as definitions. */
async function parse(text: string, moddle: Moddle, onWarning?: (message: string) => void): Promise<ModdleObject> {
  if (!looksLikeXml(text)) return studyflowToDefinitions(text, moddle, onWarning);
  const { rootElement, warnings } = await moddle.fromXML(text);
  for (const warning of warnings) onWarning?.(readerWarning(warning));
  return rootElement;
}

/** The moddle that built `definitions`: it reads and writes their files. */
function moddleOf(definitions: ModdleObject): Moddle {
  return definitions.$model as Moddle;
}

/**
 * Lay `scene` out afresh (`study/layout.ts`) and route every flow anew, those on one line slid apart
 * (`study/spread.ts`); what that moved, captions among it.
 */
function layOut(scene: Scene): SceneElement[] {
  const moved = layoutScene(scene);
  const flows = [...scene.elementsById.values()].filter((element): element is SceneEdge => element.kind === 'edge');
  for (const flow of flows) rerouteEdge(flow, { obstacles: obstaclesIn(scene, planeOf(flow)) });
  for (const plane of new Set(flows.map(planeOf))) {
    const here = flows.filter((flow) => planeOf(flow) === plane);
    const spread = spreadEdges(here.map((flow) => ({ waypoints: flow.waypoints, source: flow.source, target: flow.target })));
    here.forEach((flow, i) => { flow.waypoints = spread[i]; });
  }
  return [...moved, ...flows];
}

/** What a revision did, by id: the elements only `after` holds, those it holds otherwise, and those it no longer holds. */
function revisedIds(before: StudyModel, after: StudyModel): ChangedIds {
  const spelled = (model: StudyModel): Map<string, string> => new Map([...model.elements()].map((element) => [element.id!, JSON.stringify(element)]));
  const was = spelled(before);
  const is = spelled(after);
  const changed = [...is].filter(([id, text]) => was.has(id) && was.get(id) !== text).map(([id]) => id);
  const root = after.primaryRoot()?.id;
  return {
    added: [...is.keys()].filter((id) => !was.has(id)),
    changed: root && !changed.includes(root) && JSON.stringify(before.study.state) !== JSON.stringify(after.study.state) ? [...changed, root] : changed,
    removed: [...was.keys()].filter((id) => !is.has(id)),
  };
}

/** One scene in place of another, by id: the nodes and edges only `before` held, those only `after` holds, and the rest. */
function byId(before: Scene, after: Scene): Commit {
  const drawables = (scene: Scene): Drawable[] => [...scene.elementsById.values()].filter((element): element is Drawable => element.kind !== 'label');
  const kept = drawables(after).filter((element) => before.elementsById.has(element.id));
  return {
    added: drawables(after).filter((element) => !before.elementsById.has(element.id)),
    changed: [after.rootElement, ...kept],
    removed: drawables(before).filter((element) => !after.elementsById.has(element.id)),
  };
}
