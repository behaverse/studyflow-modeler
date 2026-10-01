/**
 * A study: the study model and the scene drawn from it, the one place it is edited, its undo history, and the news
 * of each change. It needs no DOM: a canvas is one view of a study, and several views may share one.
 */

import { parseStudy, patchDoc, studyToXml } from '@core/document/index.ts';
import type { YamlDoc } from '@core/document/format.ts';
import { categoryOf, isDataShape, isExpandable } from '@core/document/outline.ts';
import { eventDefinitionTypeOf } from '@core/element/index.ts';
import { isElement, StudyModel, type Element, type Value } from '@core/model/index.ts';
import { setItemSubjectIn, setMessageItemIn, type Ids } from '@core/model/items.ts';
import type { Metamodel } from '@core/model/metamodel.ts';
import { readStudy, studyText, writeStudy } from '@core/model/yaml.ts';
import { attributesOf, type AttributeRecord } from '@canvas/study/attributes.ts';
import { appendSpot, freeSpot } from '@canvas/study/autoplace.ts';
import { declares, describeType, extensionMisfit, NOTHING, refused, runRead, runStep, shapeFor } from '@canvas/study/calls.ts';
import { installedCatalog, type Catalog } from '@canvas/study/catalog.ts';
import { tasksReferencing } from '@canvas/study/choreography.ts';
import { writeLayout } from '@canvas/study/di.ts';
import { draftDrawing, drawDataFlow } from '@canvas/study/draft.ts';
import { Drag, type Movable } from '@canvas/study/drag.ts';
import { idsIn, listOf } from '@canvas/study/elements.ts';
import { containerOf, hitTest, obstaclesIn } from '@canvas/study/hit.ts';
import { History } from '@canvas/study/history.ts';
import { importStudy, type ImportOptions } from '@canvas/study/import.ts';
import { syncLabel } from '@canvas/study/labels.ts';
import { Mutator, type AddShapeSpec, type Commit } from '@canvas/study/mutator.ts';
import { layoutScene } from '@canvas/study/layout.ts';
import { rerouteEdge, rerouteEdges, routableEnd, routeFor } from '@canvas/study/orthogonal.ts';
import { defaultSizeFor, prototypeOf, shapeSpec, type CreatePrototype, type NewElement, type NewShape } from '@canvas/study/prototype.ts';
import { Rules } from '@canvas/study/rules.ts';
import { spreadEdges } from '@canvas/study/spread.ts';
import type { Bounds, Drawable, ElementColors, FontPatch, Point, Scene, SceneEdge, SceneElement, SceneNode } from '@canvas/study/scene.ts';
import { recordOf, type ElementRecord } from '@canvas/study/records.ts';
import { buildTemplate, findTemplate, layOutTemplate } from '@canvas/study/templates.ts';
import { copyOf, fragmentOf } from '@canvas/study/clipboard.ts';
import { ASKABLE_TOOLS, isStepTool, misfitOf, STUDY_TOOLS, type StepTool, type StudyTool, type ToolResult } from '@canvas/study/tools.ts';
import { boundsOf, edgesAffectedBy, hostOf, isDescendantOf, planeOf } from '@canvas/study/tree.ts';

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
  /** What the text is read by: the metamodel of the schemas the study uses. */
  metamodel: Metamodel;
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
 * The study as an undo snapshot: its `.studyflow.yaml` tree as JSON rather than YAML text, which holds the same and
 * is written and read back several times faster.
 */
function snapshotOf(model: StudyModel): string {
  return JSON.stringify(writeStudy(model.study, model.metamodel));
}

/** A study model of a snapshot. */
function modelOfSnapshot(snapshot: string, metamodel: Metamodel, onWarning: (message: string) => void = () => {}): StudyModel {
  return new StudyModel(readStudy(JSON.parse(snapshot) as YamlDoc, metamodel, onWarning), metamodel);
}

export class Study {
  /** The tools an AI drives a study with, as MCP lists them: each a name, a description, the JSON Schema of its argument, hints. */
  static readonly tools: readonly StudyTool[] = STUDY_TOOLS;

  private readonly listeners = new Set<ChangeListener>();
  /** Changes held back while a batch runs (`atomic`). */
  private holding: StudyChange[] | undefined;
  private readonly options: ImportOptions;
  private readonly rules = new Rules();
  /** The study after each edit, as its `.studyflow.yaml` tree in JSON ({@link snapshotOf}): what undo and redo go back and forth through. */
  private readonly history: History<string>;
  /** The last commit, for the verb that made it to report. */
  private committed?: Commit;

  private constructor(model: StudyModel, options: ImportOptions) {
    this.options = options;
    this.read(model, 0);
    // As read: a drawing drafted for an undrawn study is part of it from the start.
    this.history = new History(snapshotOf(model));
  }

  /** A study of `text`, a `.studyflow.yaml` or BPMN XML file. */
  static async open(text: string, options: OpenOptions): Promise<Study> {
    return new Study(await parseStudy(text, options.metamodel, options), options);
  }

  /** A study of `model`, which it edits in place from here on. */
  static of(model: StudyModel, options: ImportOptions = {}): Study {
    return new Study(model, options);
  }

  /** Replace the study with `source`, file text or a study model, as one change: a 'load', which the history starts over from. */
  async load(source: string | StudyModel): Promise<void> {
    const model = typeof source === 'string' ? await parseStudy(source, this.model.metamodel, this.options) : source;
    this.swap(model, 'load');
  }

  /** The study as a `.studyflow.yaml` file holds it. */
  toYaml(): string {
    const { model } = own(this).scene;
    return studyText(model.study, model.metamodel);
  }

  /** The study as a BPMN XML file holds it: an exchange as the BPMN task it is. */
  toXml(): Promise<string> {
    return studyToXml(own(this).scene.model);
  }

  /**
   * The study model the study edits: another one after a load, an undo or a redo. What reads the study reads it; what
   * edits it goes through the verbs, `revise` among them.
   */
  get model(): StudyModel {
    return own(this).scene.model;
  }

  /** The element `id` names in {@link model}, drawn or not. */
  element(id: string): Element | undefined {
    return this.model.get(id);
  }

  /** The study's root, a process or a collaboration, as data: always the study's, whatever a view shows. */
  get root(): ElementRecord {
    const { scene } = own(this);
    return recordOf(scene.model, scene.rootElement);
  }

  /** The element `id` names, as data: a shape, a flow, a caption, or the root. */
  get(id: string): ElementRecord | undefined {
    const { scene } = own(this);
    if (id === scene.rootElement.id) return this.root;
    const element = scene.elementsById.get(id);
    return element && recordOf(scene.model, element);
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
      .map((element) => recordOf(scene.model, element))
      .filter((record) => !filter.type || record.type === filter.type || record.extension === filter.type);
  }

  /** The attributes the element `id` takes, as data: by the names `set` takes, with what each holds now. */
  attributes(id: string): AttributeRecord[] | undefined {
    const found = this.find(id);
    return found && attributesOf(this.model, found.element);
  }

  /** What `add`, `append` and `replace` make, as data: the BPMN shape types, the schema types extending them, the templates. */
  catalog(): Catalog {
    const { metamodel } = this.model;
    return installedCatalog((prefix) => metamodel.package(prefix) !== undefined);
  }

  /**
   * Run the tool `name` on `args`, parsed JSON, as an MCP client calls one: the argument checked against the tool's
   * schema, a write all or nothing. Answers with one JSON object; `ok` false, and why, when the tool did nothing.
   */
  call(name: string, args: unknown = {}): ToolResult {
    if (isStepTool(name)) return this.atomic(() => runStep(this, name, args));
    const misfit = misfitOf(name, args);
    return misfit ? refused(misfit) : runRead(this, name, args);
  }

  /**
   * Whether the rules let `append`, `connect` or `replace` run on `args`, without writing, and why not: what a menu asks
   * before it offers an entry. Leave out what is not decided yet to ask about any: `can('append', { from })` asks
   * whether anything may follow `from`, `can('connect', { from })` whether a flow may leave it, `can('replace', { id })`
   * whether it may be retyped at all.
   */
  can(tool: StepTool, args: Record<string, unknown>): Verdict {
    if (!(ASKABLE_TOOLS as readonly string[]).includes(tool)) {
      // Any other write is asked by running it on a copy of the study, which is then let go.
      const copy = Study.of(modelOfSnapshot(this.history.now, this.model.metamodel), this.options);
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
    return describeType(this.model, args);
  }

  /**
   * Say what the message flow `id` carries, or what the property or data object `id` holds: the item definition of
   * `structure`, which the document keeps one of, made on first use. An empty `structure` says nothing of it.
   */
  item({ id, structure }: { id: string; structure: string }): StudyResult {
    const found = this.find(id);
    if (!found) return refused(`no element '${id}'`);
    const { model } = this;
    const carries = model.host(found.element) === 'bpmn:MessageFlow';
    if (!carries && !model.property(found.element, 'itemSubjectRef')) {
      return refused(`'${id}' is no message flow, property or data object: it holds no item`);
    }
    return this.revise(id, (element, held, ids) => (carries ? setMessageItemIn : setItemSubjectIn)(held, ids, element, structure.trim()));
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
    const { model } = this;
    const { element } = found;
    if (!declares(model, element, attribute)) return refused(`no schema gives '${id}' an attribute '${attribute}'`);
    const local = attribute.includes(':') ? attribute.slice(attribute.indexOf(':') + 1) : attribute;
    const property = model.property(element, local);
    // What BPMN keeps as an element or a reference is written as the file spells it, and cleared by taking it out;
    // text kept in an element of its own (an expression, the documentation) is written in place, as it is typed.
    const held = [element[local]].flat()[0];
    const text = typeof held === 'string' || (isElement(held) && (model.isA(held, 'bpmn:Expression') || model.isA(held, 'bpmn:Documentation')));
    const structured = !!property?.isReference || (isElement(held) && !text);
    if (value === null ? structured : typeof value === 'object' || property?.isReference) return this.spell(element, local, value, found.drawn?.id ?? this.root.id);
    // Typing into one attribute is one undo step, however many keystrokes wrote it.
    return this.within(`set:${id}:${attribute}`, () => this.commit(() => {
      const written = value === '' || value === null || value === undefined ? undefined
        : property?.isMany && typeof value === 'string' ? [value] : value as Value;
      if (model.attribute(element, local) === written) return;
      model.setAttribute(element, local, written);
      this.touched(found.drawn, [element]);
    }));
  }

  /**
   * Write `attribute` of `element` as the file spells `value`: the study's tree with that one key changed, read
   * back whole, so what the value names (a flow, a property, a data object) is what the study holds. One undo
   * step, reported on `about`. Refused, and nothing changed, when the reader cannot place something in it.
   */
  private spell(element: Element, attribute: string, value: unknown, about: string): StudyResult {
    const { model } = this;
    const read = (doc: YamlDoc): { model: StudyModel; warnings: string[] } => {
      const warnings: string[] = [];
      return { model: new StudyModel(readStudy(doc, model.metamodel, (warning) => warnings.push(warning)), model.metamodel), warnings };
    };
    const doc = JSON.parse(this.history.now) as YamlDoc;
    const known = new Set(read(JSON.parse(this.history.now) as YamlDoc).warnings);
    if (!patchDoc(doc, model, element, attribute, value)) return refused(`'${attribute}' of '${element.id}' is not written this way: edit it in the study`);
    let patched: ReturnType<typeof read>;
    try {
      patched = read(doc);
    } catch (error) {
      return refused(error instanceof Error ? error.message : String(error));
    }
    const misread = patched.warnings.find((warning) => !known.has(warning));
    if (misread) return refused(misread);
    this.read(patched.model, own(this).scene.revision + 1);
    this.history.push(snapshotOf(patched.model));
    // Another study model in place of the one it held, which every view reads afresh; the caller is told what it wrote.
    this.announce({ cause: 'edit', ...revisedIds(model, patched.model) });
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
   * Change the element `id` names, and whatever else of the study `write` reaches through the model, as one commit:
   * what the write changed is found by comparing the study before and after, and redrawn. Edits naming the same `run`
   * (a field being typed into) one after another are one undo step. In-process only, not a tool.
   */
  revise(id: string, write: (element: Element, model: StudyModel, ids: Ids) => void, run?: string): StudyResult {
    const found = this.find(id);
    if (!found) return refused(`no element '${id}'`);
    const { scene, mutator } = own(this);
    const { model } = scene;
    const edit = (): StudyResult => this.commit(() => {
      const before = textsOf(model);
      write(found.element, model, mutator.ids.minter);
      model.reindex();
      const after = textsOf(model);
      const changed = [...new Set([...before.keys(), ...after.keys()])].filter((key) => before.get(key) !== after.get(key));
      if (changed.length === 0) return;
      this.touched(found.drawn, changed.map((key) => model.get(key)).filter((element): element is Element => !!element));
    });
    return run === undefined ? edit() : this.within(`revise:${id}:${run}`, edit);
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
    if (prototype.type === node.type && prototype.extensionType === scene.model.extensionType(node.element)
      && eventDefinitionTypeOf(prototype.attrs as never) === eventDefinitionTypeOf(node.element)) {
      return { ok: true, id: node.id, ...NOTHING };
    }
    const size = categoryOf(prototype.type) === categoryOf(node.type)
      ? { width: node.width, height: node.height }
      : defaultSizeFor(prototype.type, prototype.isExpanded);
    const name = node.element.name;
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
    const fragment = fragmentOf(args.yaml, scene.model, mutator.ids);
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
        const outcome = runStep(this, step.tool, step.args);
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

  /** Edit `model` from here on, and return its scene. */
  private read(model: StudyModel, revision: number): Scene {
    // A study with no drawing is drawn as it is read, and laid out; a drawn one gets the data flow it leaves out.
    const drafted = draftDrawing(model);
    if (!drafted) drawDataFlow(model);
    const scene = importStudy(model, this.options);
    if (drafted) {
      for (const element of layOut(scene)) if (element.kind !== 'label') syncLabel(scene, element);
      writeLayout(scene);
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
   * The element `id` names: a drawn one (a caption stands for what it captions), the root, or anything else the study
   * holds, which is not drawn.
   */
  private find(id: string): { drawn?: Drawable; element: Element } | undefined {
    const { scene } = own(this);
    if (id === scene.rootElement.id) return { element: scene.rootElement.element };
    const drawn = scene.elementsById.get(id);
    if (drawn) {
      const owner = drawn.kind === 'label' ? drawn.owner : drawn;
      return { drawn: owner, element: owner.element };
    }
    const element = scene.model.get(id);
    return element && { element };
  }

  /** Record a write of `elements` in the open commit, as what draws each of them: `about`, else the root. */
  private touched(about: Drawable | undefined, elements: readonly Element[]): void {
    const { scene, mutator } = own(this);
    const drawn = new Set<Drawable>();
    for (const element of elements) {
      const node = element.id ? scene.elementsById.get(element.id) : undefined;
      if (node && node.kind !== 'label') for (const shown of redrawn(scene, node)) drawn.add(shown);
      else if (scene.model.host(element) === 'bpmn:Participant' && about?.kind === 'node') for (const task of tasksReferencing(scene, element, about)) drawn.add(task);
      else if (about) drawn.add(about);
    }
    if (drawn.size > 0) mutator.touch([...drawn]);
    else mutator.record(scene.rootElement);
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

  /** Whether `id` names an element the document already holds. */
  private taken(id: string | undefined): boolean {
    return id !== undefined && own(this).mutator.ids.assigned(id);
  }

  /** Mint `what`, whose prototype is `prototype`, centred on `at` in `place`: a template lays its elements out inside. */
  private drop(what: NewElement & { id?: string }, prototype: CreatePrototype, at: Point, place: Pick<AddShapeSpec, 'parent' | 'attachTo'>): SceneNode {
    const { scene, mutator, rules } = own(this);
    const template = 'template' in what ? findTemplate(what.template) : undefined;
    if (!template) return mutator.addShape({ ...shapeSpec(prototype, at, what.id), ...place });
    const build = buildTemplate(template, scene.model, mutator.ids);
    const node = mutator.addShape({ ...shapeSpec(prototype, at), type: scene.model.host(build.root), element: build.root, ...place });
    layOutTemplate(mutator, rules, node, build, (element) => scene.model.host(element));
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
    writeLayout(scene);
    this.history.record(snapshotOf(scene.model));
    this.announce({ cause: 'edit', ...idsOf(commit) });
  }

  /** Step through the history: what the step changed, or nothing past either end. */
  private travel(step: -1 | 1): StudyResult | undefined {
    const snapshot = this.history.travel(step);
    if (snapshot === undefined) return undefined;
    const model = modelOfSnapshot(snapshot, this.model.metamodel, this.options.onWarning);
    return { ok: true, ...this.swap(model, step < 0 ? 'undo' : 'redo') };
  }

  /** Put `model` in place of the study, as one change; a load starts the history over. */
  private swap(model: StudyModel, cause: 'load' | 'undo' | 'redo'): ChangedIds {
    const before = own(this).scene;
    const after = this.read(model, before.revision + 1);
    if (cause === 'load') this.history.reset(snapshotOf(model));
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

function idsOf({ added, changed, removed }: Commit): ChangedIds {
  const ids = (elements: readonly { id: string }[]): string[] => elements.map((element) => element.id);
  return { added: ids(added), changed: ids(changed), removed: ids(removed) };
}

/** What shows `node`'s element once it changes: `node`, and whatever else draws it. */
function redrawn(scene: Scene, node: Drawable): Drawable[] {
  // A participant's name is drawn on every choreography task it takes a band of.
  if (node.kind === 'node' && node.type === 'bpmn:Participant') return tasksReferencing(scene, node.element, node);
  const drawn = new Set<Drawable>([node]);
  // A flow draws its source's `default` as a slash, so every flow that leaves the source redraws.
  if (node.kind === 'node' && scene.model.property(node.element, 'default')) for (const edge of node.outgoing) drawn.add(edge);
  // A step may draw what the data it reads holds (a glyph a Parameters object sets).
  if (node.kind === 'node' && isDataShape(node.type)) {
    for (const element of scene.elementsById.values()) {
      if (element.kind !== 'node' || element === node) continue;
      if (listOf(element.element, 'dataInputAssociations').some((association) => idsIn(association.sourceRef).includes(node.id))) drawn.add(element);
    }
  }
  return [...drawn];
}

/** Each element of `model` by id, as text, with what it holds that has an id of its own named by that id; and the
 * study's own (`''`): its definitions and its run state. */
function textsOf(model: StudyModel): Map<string, string> {
  const texts = new Map<string, string>([['', JSON.stringify([model.study.definitions, model.study.state ?? null])]]);
  for (const element of model.elements()) {
    texts.set(element.id!, JSON.stringify(element, (key, value) => (key !== '' && isElement(value) && typeof value.id === 'string' ? `#${value.id}` : value)));
  }
  return texts;
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
