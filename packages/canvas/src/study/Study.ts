/**
 * A study: the document (its BPMN definitions and the scene drawn from them), the one place it is
 * edited, its undo history, and the news of each change. It needs no DOM: a canvas is one view of a
 * study, and several views may share one.
 */

import { definitionsToStudyflow, fromWireDefinitions, looksLikeXml, readerWarning, studyflowToDefinitions, toWireDefinitions, toWireXml } from '@core/document';
import { categoryOf, isExpandable } from '@core/document/outline.ts';
import { eventDefinitionTypeOf, getAttributeSpec, getExtensionType, setAttribute, StudyflowElement } from '@core/element/index.ts';
import { getProperty, type Moddle } from '@core/element/moddle.ts';
import { getCatalog, hasCatalog, isBpmnSubtypeOf } from '@core/notation/index.ts';
import { attributesOf, type AttributeRecord } from '@canvas/study/attributes.ts';
import { appendSpot, freeSpot } from '@canvas/study/autoplace.ts';
import { installedCatalog, type Catalog } from '@canvas/study/catalog.ts';
import { writeDi } from '@canvas/study/di.ts';
import { Drag, type Movable } from '@canvas/study/drag.ts';
import { containerOf, hitTest, obstaclesIn } from '@canvas/study/hit.ts';
import { importDefinitions, type ImportOptions } from '@canvas/study/import.ts';
import { findById } from '@canvas/study/moddle.ts';
import { Mutator, type AddShapeSpec, type Commit } from '@canvas/study/mutator.ts';
import { rerouteEdges, routableEnd, routeFor } from '@canvas/study/orthogonal.ts';
import { defaultSizeFor, prototypeOf, shapeSpec, type CreatePrototype, type NewElement, type NewShape } from '@canvas/study/prototype.ts';
import { Rules } from '@canvas/study/rules.ts';
import type { Bounds, Drawable, ElementColors, FontPatch, ModdleObject, Point, Scene, SceneEdge, SceneElement, SceneNode } from '@canvas/study/scene.ts';
import { recordOf, type ElementRecord } from '@canvas/study/records.ts';
import { buildTemplate, findTemplate, layOutTemplate, shapeOf } from '@canvas/study/templates.ts';
import { isStepTool, misfitOf, STUDY_TOOLS, type AskableTool, type StepTool, type StudyTool, type ToolName, type ToolResult } from '@canvas/study/tools.ts';
import { edgesAffectedBy, isDescendantOf, planeOf } from '@canvas/study/tree.ts';
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

/** How many edits an undo can go back through. */
const UNDO_DEPTH = 50;

/** What the canvas package reads and writes behind a study's public surface. */
export interface StudyInternals {
  readonly scene: Scene;
  readonly mutator: Mutator;
  /** What may connect, contain or resize what: the study's verbs and every view's gestures ask the same rules. */
  readonly rules: Rules;
  /**
   * Make the edits `edit` commits part of the run `key`: edits under one key, each within `RUN_WINDOW_MS` of the last,
   * are one undo step (a run of arrow-key nudges of one selection).
   */
  runAs(key: string, edit: () => void): void;
}

/** Edits of one run this close together are one undo step. */
const RUN_WINDOW_MS = 1000;

const internals = new WeakMap<Study, StudyInternals>();

/** The scene and mutator behind `study`, for the canvas's views and gestures. The package index does not export it. */
export function studyInternals(study: Study): StudyInternals {
  return internals.get(study)!;
}

export class Study {
  /** The tools an AI drives a study with, as MCP lists them: each a name, a description, the JSON Schema of its argument, hints. */
  static readonly tools: readonly StudyTool[] = STUDY_TOOLS;

  private readonly listeners = new Set<ChangeListener>();
  private readonly options: ImportOptions;
  private readonly rules = new Rules();
  /** The document after each edit, as `.studyflow.yaml` text, oldest first: what undo and redo go back and forth through. */
  private snapshots: string[];
  /** The snapshot of the document the study holds. */
  private current = 0;
  /** The last commit, for the verb that made it to report. */
  private committed?: Commit;
  /** The run the edit under way belongs to, and the run the last edit did, with when it was made. */
  private runKey?: string;
  private run?: { key: string; at: number };

  private constructor(definitions: ModdleObject, options: ImportOptions) {
    this.options = options;
    this.read(definitions, 0);
    // As read, before any edit: the DI is the file's, so nothing is written back yet.
    this.snapshots = [definitionsToStudyflow(definitions)];
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

  /** The document as a `.studyflow.yaml` file holds it: the drawing written into its DI, and a pure choreography on its own root. */
  toYaml(): string {
    const { scene } = studyInternals(this);
    writeDi(scene);
    const text = definitionsToStudyflow(scene.definitions);
    // A pure choreography is edited on a process; its file holds it on a choreography root, written from a copy.
    const copy = studyflowToDefinitions(text, moddleOf(scene.definitions), () => {});
    return toWireDefinitions(copy) ? definitionsToStudyflow(copy) : text;
  }

  /** The document as a BPMN XML file holds it: the drawing written into its DI, and a pure choreography on its own root. */
  async toXml(): Promise<string> {
    const { scene } = studyInternals(this);
    writeDi(scene);
    const moddle = moddleOf(scene.definitions);
    const { xml } = await moddle.toXML(scene.definitions, { format: true });
    return toWireXml(xml, moddle);
  }

  /** The `bpmn:Definitions` the study edits: another object after a load, an undo or a redo. */
  get definitions(): ModdleObject {
    return studyInternals(this).scene.definitions;
  }

  /** The document's root, a process or a collaboration, as data: always the document's, whatever a view shows. */
  get root(): ElementRecord {
    return recordOf(studyInternals(this).scene.rootElement);
  }

  /** The element `id` names, as data: a shape, a flow, a caption, or the root. */
  get(id: string): ElementRecord | undefined {
    const { scene } = studyInternals(this);
    if (id === scene.rootElement.id) return this.root;
    const element = scene.elementsById.get(id);
    return element && recordOf(element);
  }

  /**
   * The shapes and flows, as data, in the order the document holds them: those of `kind` (captions too, with
   * 'label'), of `type` (a BPMN type or the schema type extending it), `within` a container however deep.
   */
  list(filter: { kind?: 'node' | 'edge' | 'label'; type?: string; within?: string } = {}): ElementRecord[] {
    const { scene } = studyInternals(this);
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
    const argument = args as any;
    switch (name as Exclude<ToolName, StepTool>) {
      case 'document': return { ok: true, yaml: this.toYaml() };
      case 'get': {
        const element = this.get(argument.id);
        return element ? { ok: true, element } : refused(`no element '${argument.id}'`);
      }
      case 'list': return { ok: true, elements: this.list(argument) };
      case 'catalog': return { ok: true, ...this.catalog() };
      case 'can': return this.can(argument.tool, argument.args);
      case 'attributes': {
        const attributes = this.attributes(argument.id);
        return attributes ? { ok: true, attributes } : refused(`no element '${argument.id}'`);
      }
      case 'batch': return this.batch(argument);
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
  can(tool: AskableTool, args: Record<string, unknown>): Verdict {
    const checked = misfitOf(tool, args, ['to', 'type'])
      ?? (tool === 'append' ? this.appending(args as never) : tool === 'connect' ? this.connecting(args as never) : this.replacing(args as never));
    return typeof checked === 'string' ? { ok: false, reason: checked } : { ok: true };
  }

  /** Goes up by one on every change. */
  get revision(): number {
    return studyInternals(this).scene.revision;
  }

  /**
   * Set `attribute` on the element `id` names, where its schema keeps it (core's `setAttribute`); 'name' renames. An
   * attribute neither a schema nor BPMN gives the element is refused, never written as a stray.
   */
  set({ id, attribute, value }: { id: string; attribute: string; value: unknown }): StudyResult {
    const found = this.find(id);
    if (!found) return refused(`no element '${id}'`);
    if (!declares(found.moddle, attribute)) return refused(`no schema gives '${id}' an attribute '${attribute}'`);
    return this.write(found.drawn, (writer) => setAttribute(found.moddle, attribute, value, writer));
  }

  /** Write the moddle behind `id` in place, as one commit: for what `set` cannot spell. In-process only, not a tool. */
  edit(id: string, write: (writer: StudyWriter) => void): StudyResult {
    const found = this.find(id);
    if (!found) return refused(`no element '${id}'`);
    return this.write(found.drawn, write);
  }

  /**
   * Add `what` centred on `at` (without it, beside the shapes it joins), into the container `into` names (the root's
   * id for the top level; without one, whatever is under `at`). `id` names it, when free; a template keeps its own.
   */
  add(args: NewElement & { id?: string; at?: Point; into?: string }): StudyResult {
    const { scene, rules } = studyInternals(this);
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
    const { scene } = studyInternals(this);
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
    const { scene, mutator } = studyInternals(this);
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
    const { scene, mutator, rules } = studyInternals(this);
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
      mutator,
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
  reconnect(args: { id: string; from?: string; to?: string }): StudyResult {
    const { scene, mutator, rules } = studyInternals(this);
    const edge = scene.elementsById.get(args.id);
    if (edge?.kind !== 'edge') return refused(`no flow '${args.id}'`);
    if (args.from === undefined && args.to === undefined) return refused('give the new end: from, to, or both');
    const source = args.from === undefined ? edge.source : scene.elementsById.get(args.from);
    const target = args.to === undefined ? edge.target : scene.elementsById.get(args.to);
    if (source?.kind !== 'node') return refused(`no shape '${args.from ?? edge.source?.id}'`);
    if (target?.kind !== 'node') return refused(`no shape '${args.to ?? edge.target?.id}'`);
    if (!rules.canReconnect(edge, source, target)) return refused(`a ${edge.type} cannot run from '${source.id}' to '${target.id}'`);
    return this.commit(() => {
      mutator.reconnect(edge, { source, target }, routeFor(edge.type, source, target));
    });
  }

  /** Give the shape `id` new bounds, as one edit. */
  resize(args: { id: string; bounds: Bounds }): StudyResult {
    const { scene, mutator, rules } = studyInternals(this);
    const node = scene.elementsById.get(args.id);
    if (node?.kind !== 'node') return refused(`no shape '${args.id}'`);
    if (!rules.canResize(node)) return refused(`'${args.id}' keeps its size`);
    return this.commit(() => {
      mutator.setNodeBounds(node, args.bounds);
    });
  }

  /** Route the flow `id` through `waypoints`, or squarely between its ends without them, as one edit. */
  reroute(args: { id: string; waypoints?: Point[] }): StudyResult {
    const { scene, mutator } = studyInternals(this);
    const edge = scene.elementsById.get(args.id);
    if (edge?.kind !== 'edge') return refused(`no flow '${args.id}'`);
    const { waypoints } = args;
    if (waypoints && waypoints.length < 2) return refused('a route runs through two waypoints at least');
    return this.commit(() => {
      if (waypoints) mutator.setEdgeWaypoints(edge, waypoints);
      else mutator.commit(rerouteEdges([edge], { obstacles: obstaclesIn(scene, planeOf(edge)) }));
    });
  }

  /** Remove `ids` and all that goes with them (contents, flows), as one edit; a caption's id clears the name it shows. */
  remove(args: { ids: string[] }): StudyResult {
    const { mutator } = studyInternals(this);
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
    const { mutator } = studyInternals(this);
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
    return this.current > 0;
  }

  get canRedo(): boolean {
    return this.current < this.snapshots.length - 1;
  }

  /** Hear each change, once, in the order listeners subscribed; the returned function unsubscribes. */
  on(_event: 'change', listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Edit `definitions` from here on, in the form the canvas edits (as a file opens), and return their scene. */
  private read(definitions: ModdleObject, revision: number): Scene {
    fromWireDefinitions(definitions, this.options.onWarning);
    const scene = importDefinitions(definitions, this.options);
    scene.revision = revision;
    internals.set(this, {
      scene,
      mutator: new Mutator(scene, (commit) => this.edited(commit)),
      rules: this.rules,
      runAs: (key, edit) => this.runAs(key, edit),
    });
    return scene;
  }

  /**
   * The element `id` names, and the moddle behind it: a drawn one (a caption stands for what it captions), the root,
   * or anything else the document holds, which is not drawn.
   */
  private find(id: string): { drawn?: Drawable; moddle: ModdleObject } | undefined {
    const { scene } = studyInternals(this);
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
    const { scene, mutator } = studyInternals(this);
    return this.commit(() => write(writerFor(scene, mutator, drawn)));
  }

  /** Run `edit` as one commit, and say what it did by id: `id` is the element it made, when it returns one. */
  private commit(edit: () => Drawable | undefined | void): StudyResult {
    const { mutator } = studyInternals(this);
    this.takeCommitted();
    const made = mutator.batch(edit);
    const commit = this.takeCommitted();
    return { ok: true, ...(made ? { id: made.id } : {}), ...(commit ? idsOf(commit) : NOTHING) };
  }

  /** The elements `ids` name, or the first id that names none. */
  private elements(ids: readonly string[]): SceneElement[] | string {
    const { scene } = studyInternals(this);
    const found: SceneElement[] = [];
    for (const id of ids) {
      const element = scene.elementsById.get(id);
      if (!element) return id;
      found.push(element);
    }
    return found;
  }

  private open(id: string, expanded: boolean): StudyResult {
    const { scene, mutator } = studyInternals(this);
    const node = scene.elementsById.get(id);
    if (node?.kind !== 'node' || !isExpandable(node.type)) return refused(`'${id}' holds no contents to ${expanded ? 'show' : 'hide'}`);
    return this.commit(() => {
      mutator.setExpanded(node, expanded);
    });
  }

  /** What `append` would join, or why it would refuse; without a shape or a template, whether anything may follow `from`. */
  private appending(args: { from: string } & Partial<NewShape> & { template?: string }): { source: Drawable; shape?: NewShape } | string {
    const { scene, rules } = studyInternals(this);
    const source = scene.elementsById.get(args.from);
    if (!source || source.kind === 'label') return `no element '${args.from}'`;
    const shape = 'type' in args || 'template' in args ? shapeFor(args as NewElement) : undefined;
    if (typeof shape === 'string') return shape;
    if (!rules.canAppendType(source, shape?.type)) return shape ? `nothing appends a ${shape.type} to '${args.from}'` : `nothing follows '${args.from}'`;
    return { source, ...(shape ? { shape } : {}) };
  }

  /** What `connect` would join, or why it would refuse; without `to`, whether any flow may leave `from`. */
  private connecting(args: { from: string; to?: string }): { source: Drawable; target?: SceneNode } | string {
    const { scene, rules } = studyInternals(this);
    const source = scene.elementsById.get(args.from);
    if (!source || source.kind === 'label') return `no element '${args.from}'`;
    if (args.to === undefined) return rules.canStartConnection(source) ? { source } : `nothing leaves '${args.from}'`;
    const target = scene.elementsById.get(args.to);
    if (target?.kind !== 'node') return `no shape '${args.to}'`;
    return rules.canConnect(source, target) ? { source, target } : `nothing connects '${args.from}' to '${args.to}'`;
  }

  /** What `replace` would retype, and into what, or why it would refuse; without `type`, whether `id` may be retyped at all. */
  private replacing(args: { id: string } & Partial<NewShape>): { node: SceneNode; prototype?: CreatePrototype } | string {
    const { scene, rules } = studyInternals(this);
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
    const before = this.snapshots[this.current];
    let outcome = refused('nothing ran');
    const result = this.commit(() => {
      outcome = run();
    });
    if (outcome.ok) return { ...result, ...(outcome.id ? { id: outcome.id } : {}) };
    if (this.snapshots[this.current] !== before) {
      this.travel(-1);
      // What the refused edit wrote is no state to go forward to.
      this.snapshots.length = this.current + 1;
    }
    return outcome;
  }

  /** A write tool as a batch runs it: on `args` checked against the tool's schema; one that throws is refused. */
  private step(tool: string, args: unknown): StudyResult {
    const misfit = misfitOf(tool, args);
    if (misfit) return refused(misfit);
    if (!isStepTool(tool)) return refused(`a batch runs no '${tool}'`);
    const verbs: Record<StepTool, (args: any) => StudyResult> = {
      add: (a) => this.add(a),
      append: (a) => this.append(a),
      connect: (a) => this.connect(a),
      replace: (a) => this.replace(a),
      move: (a) => this.move(a),
      reconnect: (a) => this.reconnect(a),
      resize: (a) => this.resize(a),
      reroute: (a) => this.reroute(a),
      set: (a) => this.set(a),
      remove: (a) => this.remove(a),
      style: (a) => this.style(a),
      expand: (a) => this.expand(a),
      collapse: (a) => this.collapse(a),
    };
    try {
      return verbs[tool](args);
    } catch (error) {
      return refused(error instanceof Error ? error.message : String(error));
    }
  }

  /** Whether `id` names an element the document already holds. */
  private taken(id: string | undefined): boolean {
    return id !== undefined && studyInternals(this).mutator.ids.assigned(id);
  }

  /** Mint `what`, whose prototype is `prototype`, centred on `at` in `place`: a template lays its elements out inside. */
  private drop(what: NewElement & { id?: string }, prototype: CreatePrototype, at: Point, place: Pick<AddShapeSpec, 'parent' | 'attachTo'>): SceneNode {
    const { scene, mutator, rules } = studyInternals(this);
    const template = 'template' in what ? findTemplate(what.template) : undefined;
    if (!template) return mutator.addShape({ ...shapeSpec(prototype, at, what.id), ...place });
    const build = buildTemplate(template, scene.definitions, mutator.ids);
    const node = mutator.addShape({ ...shapeSpec(prototype, at), type: build.root.$type, businessObject: build.root, ...place });
    layOutTemplate(mutator, rules, node, build);
    return node;
  }

  /** Connect `source` to `target`, routed, as the rules allow; nothing when they refuse. */
  private link(source: SceneNode | SceneEdge, target: SceneNode, id?: string): SceneEdge | undefined {
    const { mutator, rules } = studyInternals(this);
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

  private runAs(key: string, edit: () => void): void {
    this.runKey = key;
    try {
      edit();
    } finally {
      this.runKey = undefined;
    }
  }

  /**
   * A commit: the document as it now stands is the newest snapshot, unless it is the one the study holds. An edit
   * that carries on the last one's run takes the place of its snapshot, so the run undoes as one step.
   */
  private edited(commit: Commit): void {
    this.committed = commit;
    const { scene } = studyInternals(this);
    writeDi(scene);
    const snapshot = definitionsToStudyflow(scene.definitions);
    const now = Date.now();
    const carriesOn = this.runKey !== undefined && this.run?.key === this.runKey && now - this.run.at <= RUN_WINDOW_MS;
    if (snapshot !== this.snapshots[this.current]) {
      if (carriesOn && this.current > 0) this.snapshots[this.current] = snapshot;
      else {
        this.snapshots.length = this.current + 1;
        this.snapshots.push(snapshot);
        if (this.snapshots.length > UNDO_DEPTH + 1) this.snapshots.shift();
        this.current = this.snapshots.length - 1;
      }
    }
    this.run = this.runKey === undefined ? undefined : { key: this.runKey, at: now };
    this.announce({ cause: 'edit', ...idsOf(commit) });
  }

  /** Step through the history: what the step changed, or nothing past either end. */
  private travel(step: -1 | 1): StudyResult | undefined {
    const snapshot = this.snapshots[this.current + step];
    if (snapshot === undefined) return undefined;
    this.current += step;
    this.run = undefined;
    return { ok: true, ...this.swap(studyflowToDefinitions(snapshot, moddleOf(this.definitions), this.options.onWarning), step < 0 ? 'undo' : 'redo') };
  }

  /** Put `definitions` in place of the document, as one change; a load starts the history over. */
  private swap(definitions: ModdleObject, cause: 'load' | 'undo' | 'redo'): ChangedIds {
    const before = studyInternals(this).scene;
    const after = this.read(definitions, before.revision + 1);
    if (cause === 'load') {
      this.snapshots = [definitionsToStudyflow(definitions)];
      this.current = 0;
      this.run = undefined;
    }
    const change = idsOf(byId(before, after));
    this.announce({ cause, ...change });
    return change;
  }

  private announce(change: StudyChange): void {
    for (const listener of [...this.listeners]) listener(change);
  }
}

const NOTHING: ChangedIds = { added: [], changed: [], removed: [] };

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
