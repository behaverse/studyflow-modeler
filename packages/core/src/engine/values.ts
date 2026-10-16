import { evaluateFeel } from '@core/expression/feel';
import { PLACEHOLDER } from '@core/model/state';
import { CONTAINER_TYPES, DATA_TYPES, type Graph } from '@core/engine/graph';
import type { Note, StateTree } from '@core/engine/host';
import type { Expression, PlanElement } from '@core/engine/plan';
import type { Happening } from '@core/engine/record';

/** One pool instance's own part of the values: which pool, the study's values it sits on, and what it holds itself. */
type Own = { pool: string; study: Values; state: StateTree; held: Map<string, unknown> };

/**
 * What a run holds: the `state` tree (`state.<scope>.<property>`, and `state._meta`, the walk's own), what each
 * element produced this run, and the order the walk reached them in. Every expression reads from here.
 */
export class Values {
  readonly state: StateTree;
  readonly trace: string[];
  /** What each element produced this run, by id. */
  readonly held: Map<string, unknown>;
  private readonly graph: Graph;
  /** Every change to the state is an event of the run's record, which the state can be recovered from. */
  private readonly record: (happened: Happening) => void;
  /** A pool instance's own state and values, under the study's (`forInstance`); none for the study's own. */
  private readonly own?: Own;

  constructor(graph: Graph, state: StateTree, record: (happened: Happening) => void = () => undefined, own?: Own) {
    this.graph = graph;
    this.record = record;
    this.own = own;
    if (own) {
      this.state = overlay(own.study.state, own.state, (scope) => this.owns(scope));
      this.held = new InstanceHeld(own.study.held, own.held, (id) => this.holds(id));
      this.trace = own.study.trace;
    } else {
      this.state = state;
      this.held = new Map();
      this.trace = [];
    }
  }

  /**
   * The values one instance of a pool of several reads and writes: the pool's process, the sub-processes and
   * repeating activities inside it, its passes (`state._meta.instance`), and what its elements produced are its own;
   * the rest is the study's, shared with every instance (the counts a node's properties keep, the data elements, the
   * other pools). So instances that run at once do not read each other's arm or properties. What an instance writes
   * of its own reaches the study's too, as it is written, so the study's state is always what the record replays to.
   */
  forInstance(pool: string): Values {
    return new Values(this.graph, {}, this.record, { pool, study: this, state: {}, held: new Map() });
  }

  /** Whether a scope is an instance's own: its pool's process, or a sub-process or repeating activity in it. A plain
   * element's properties are the study's (`Excluded (n={count})` counts every participant). */
  private owns(scope: string): boolean {
    const { pool } = this.own!;
    if (scope === pool) return true;
    const element = this.graph.elements[scope];
    if (!element || this.graph.poolOf(scope) !== pool) return false;
    return CONTAINER_TYPES.has(element.type) || !!element.loop;
  }

  /** Whether a value under an id is an instance's own: what an element of its pool produced, or a property of a scope
   * it owns; a data element's is the study's. */
  private holds(id: string): boolean {
    const declared = this.graph.propertyScope(id);
    if (declared) return this.owns(declared.scope);
    const element = this.graph.elements[id];
    return !!element && !DATA_TYPES.has(element.type) && this.graph.poolOf(id) === this.own!.pool;
  }

  /** One more token at an element, or along a sequence flow: `state._meta.reached.<id>`, kept in the study's state. */
  count(id: string): void {
    const reached = this.meta('reached');
    reached[id] = (reached[id] ?? 0) + 1;
    this.record({ event: 'reached', id });
  }

  /** The pass a pool's instance or a repeating activity is on: `state._meta.instance.<id>`, 1-based. */
  instance(id: string, pass: number): void {
    this.meta('instance')[id] = pass;
    if (this.own) this.own.study.meta('instance')[id] = pass;
    this.record({ event: 'instance', id, instance: pass });
  }

  /** A property of `scope` written, or cleared with no `value`. */
  set(scope: string, name: string, ...value: [unknown?]): void {
    put(this.state, scope, name, value);
    if (this.own && this.owns(scope)) put(this.own.study.state, scope, name, value);
    this.record(value.length > 0 ? { event: 'wrote', scope, name, value: value[0] } : { event: 'wrote', scope, name });
  }

  meta(quantity: string): Record<string, any> {
    return ((this.state._meta ??= {})[quantity] ??= {});
  }

  /** A value under an element's id. A data edge into a declared property writes the study state too:
   * `state.<scope>.<name>`, wherever the value came from. */
  store(id: string, value: unknown): void {
    this.held.set(id, value);
    const declared = this.graph.propertyScope(id);
    if (declared) this.set(declared.scope, declared.name, value);
  }

  /**
   * A value written under a property's name by whatever runs `from` (a runner in the walk's own process has no state
   * file to hand back): into the innermost scope around `from` that declares the name, which is returned, or
   * nowhere when none does. A property the Parameters wired into a sub-process set is not written.
   */
  write(name: string, value: unknown, from: string): string | undefined {
    const scope = this.graph.scopeChain(from).find((candidate) => this.graph.properties.get(candidate)?.has(name));
    if (!scope) return undefined;
    if (this.graph.readonly.get(scope)?.has(name)) {
      throw new Error(`'${name}' is set by the Parameters wired into ${scope}, so nothing inside it writes it.`);
    }
    const declared = this.graph.properties.get(scope)!.get(name)!;
    this.set(scope, name, value);
    if (declared.id) this.held.set(declared.id, value);
    return scope;
  }

  /** The properties in scope of an element, by name: what `{name}` and a condition read there. */
  inScope(id: string): Record<string, unknown> {
    const declared = Object.fromEntries(this.graph.scopeChain(id).reverse()
      .flatMap((scope) => [...(this.graph.properties.get(scope)?.keys() ?? [])].map((name) => [name, undefined])));
    return { ...declared, ...this.scopeValues(id) };
  }

  /** What an expression reads: `state`, then every element's value by its id and by its name. */
  private namespace(): Record<string, unknown> {
    const space: Record<string, unknown> = { state: { ...this.state, trace: [...this.trace] } };
    for (const [id, value] of this.held) {
      space[id] = value;
      const name = this.graph.plan.names[id];
      if (name) space[name] = value;
    }
    return space;
  }

  /** The properties in scope of an element, the innermost winning. */
  private scopeValues(id: string): Record<string, unknown> {
    const space: Record<string, unknown> = {};
    for (const scope of this.graph.scopeChain(id).reverse()) {
      const held = this.state[scope] ?? {};
      for (const name of this.graph.properties.get(scope)?.keys() ?? []) if (name in held) space[name] = held[name];
    }
    return space;
  }

  /** A FEEL expression's value. `language` is BPMN's per-expression attribute: unset or FEEL, else refused. `scope` is
   * the evaluating element: the properties declared on it and its containers are bound by name. */
  evaluate(expression: Expression, scope?: string, extra: Record<string, unknown> = {}): unknown {
    if (expression.language && !expression.language.toLowerCase().includes('feel')) {
      throw new Error(`a ${expression.language} expression — every Studyflow expression is FEEL`);
    }
    // Every property declared in scope is bound, one not written yet as null, so a condition may test it before a pass sets it.
    const { value, error } = evaluateFeel(expression.body, { ...this.namespace(), ...(scope ? this.inScope(scope) : {}), ...extra });
    if (error) throw new Error(error);
    return value;
  }

  /** Initialise the scope's properties from `value`; `reset` re-initialises ones the tree already holds. */
  startScope(id: string, reset: boolean, note: Note): void {
    for (const [name, declared] of this.graph.properties.get(id) ?? []) {
      if (declared.value === undefined) {
        // A property with no initial value starts each pass of its scope unset, so nothing a pass before wrote leaks
        // in; a list pass's item and output, which the loop sets before the pass, are the loop's.
        const loop = this.graph.get(id)?.loop;
        const bound = loop?.kind === 'multiInstance' && (name === loop.inputItem || name === loop.outputItem);
        if (reset && declared.id && !bound && name in (this.state[id] ?? {})) {
          delete this.state[id][name];
          this.held.delete(declared.id);
        }
        continue;
      }
      if (name.startsWith('_')) {
        note('state.reserved', `    ${id}.${name}: names starting with _ are reserved`, { level: 'warning' });
        continue;
      }
      if (reset || !(name in (this.state[id] ?? {}))) {
        this.set(id, name, structuredClone(declared.value));
        // The value space reads the same, so a hand-off cannot echo the pass before back into a reset scope.
        if (declared.id) this.held.set(declared.id, this.state[id][name]);
      }
    }
  }

  /**
   * What `{path}` cites at `scope` (docs/reference.qmd, "Placeholders"): `state` from its root; then, from the element
   * outward, what each scope holds under the name; then an element's value, by id or name; then, for a lone
   * `{reached}`, the element's own counter, 0 when no run reached it. Undefined when nothing holds it.
   */
  cite(path: string, scope: string): unknown {
    const [head, ...fields] = path.split('.');
    if (head === 'state') return dig(this.state, fields);
    for (const id of this.graph.scopeChain(scope)) {
      const found = dig(this.state[id], [head, ...fields]);
      if (found !== undefined && found !== null) return found;
    }
    const named = Object.entries(this.graph.plan.names).find(([, name]) => name === head)?.[0];
    const id = this.held.has(head) ? head : named;
    const found = id === undefined ? undefined : dig(this.held.get(id), fields);
    if ((found === undefined || found === null) && head === 'reached' && fields.length === 0) return this.meta('reached')[scope] ?? 0;
    return found ?? undefined;
  }

  /** An element's attributes with its placeholders resolved, as a runner is handed them beside the plan's: its own,
   * and those of the type that types it (a `behaverse:Task`'s `timeline`), the element's winning a name both hold. An
   * attribute that is one placeholder alone is what it cites, as held (a number stays a number), any other has each
   * placeholder that resolves filled in, and one that resolves to nothing stays as written. */
  resolved(element: PlanElement): Record<string, unknown> {
    const cited = (path: string): unknown => this.cite(path, element.id);
    const typed = Object.entries(element.extensions.find((extension) => extension.typed)?.attributes ?? {})
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string');
    return Object.fromEntries(Object.entries({ ...Object.fromEntries(typed), ...element.attributes }).map(([name, text]) => {
      const whole = new RegExp(`^${PLACEHOLDER.source}$`, 'u').exec(text.trim());
      if (whole) return [name, cited(whole[1]) ?? text];
      return [name, text.replace(PLACEHOLDER, (written, path: string) => {
        const value = cited(path);
        return value === undefined ? written : typeof value === 'string' ? value : JSON.stringify(value);
      })];
    }));
  }

  /** The JSON-able shadow of the run's values, for a runner's placeholders and intents, with the state tree under the
   * one key no element may take. */
  json(): Record<string, unknown> {
    const shadow: Record<string, unknown> = {};
    for (const [id, value] of this.held) {
      try {
        const json = JSON.stringify(value);
        if (json !== undefined) shadow[id] = JSON.parse(json);
      } catch { /* not JSON-able: it stays with the walk */ }
    }
    shadow.state = JSON.parse(JSON.stringify(this.state));
    return shadow;
  }

  /** What an activity sends: its data inputs by source id; one without a value this run gives its `uri`, else null. */
  inputsOf(element: PlanElement): Record<string, unknown> | null {
    const sources = element.inputs.map((input) => input.source);
    return sources.length === 0 ? null : Object.fromEntries(sources.map((source) => [source, this.inputValue(source)]));
  }

  /** A data input's value: a declared property's from its scope (a list pass's item), else what the element holds
   * this run, else its `uri`. */
  private inputValue(source: string): unknown {
    const declared = this.graph.propertyScope(source);
    if (declared && !this.held.has(source)) return this.state[declared.scope]?.[declared.name] ?? null;
    return this.held.has(source) ? this.held.get(source) : this.graph.uriOf(source) ?? null;
  }

  /** A claimed step's result into the properties its data edges target, narrowed by each edge's `transformation`
   * (FEEL over `result` and the properties in scope), where its runner bound none itself: a property is the study's
   * state, written the same way whichever runner ran the step. Data objects and stores stay the runner's to fill. */
  bindProperties(element: PlanElement, value: unknown, bound: ReadonlySet<string>): void {
    for (const { target, transformation, language } of element.outputs) {
      if (!target || bound.has(target) || !this.graph.propertyScope(target)) continue;
      const narrowed = value !== null && value !== undefined && transformation
        ? this.evaluate({ body: transformation, language }, element.id, { result: value })
        : value;
      this.store(target, narrowed);
    }
  }

  /** A result the walk took itself (a message's content): under the element's id, and into each data output,
   * narrowed by that edge's `transformation` (`upper case(result)`); a null result stays null. */
  bind(element: PlanElement, value: unknown): void {
    this.store(element.id, value);
    for (const { target, transformation, language } of element.outputs) {
      if (!target) continue;
      const narrowed = value !== null && value !== undefined && transformation
        ? this.evaluate({ body: transformation, language }, element.id, { result: value })
        : value;
      this.store(target, narrowed);
    }
  }
}

/**
 * A state tree that reads and writes the scopes `owns` names (and `_meta.instance`) in `own`, every other in `study`:
 * what one pool instance sees. It reads as a plain tree, to expressions, to a spread and to JSON.
 */
function overlay(study: StateTree, own: StateTree, owns: (scope: string) => boolean): StateTree {
  const passes = (): Record<string, any> => ((own._meta ??= {}).instance ??= {});
  const meta: Record<string, any> = new Proxy({}, {
    get: (_target, key) => (key === 'instance' ? passes() : typeof key === 'string' ? study._meta?.[key] : undefined),
    set: (_target, key, value) => {
      if (key === 'instance') (own._meta ??= {}).instance = value;
      else if (typeof key === 'string') (study._meta ??= {})[key] = value;
      return true;
    },
    has: (_target, key) => key === 'instance' || (typeof key === 'string' && key in (study._meta ?? {})),
    ownKeys: () => [...new Set([...Object.keys(study._meta ?? {}), 'instance'])],
    getOwnPropertyDescriptor: (_target, key): PropertyDescriptor | undefined =>
      (typeof key === 'string' && key in meta ? { value: meta[key], writable: true, enumerable: true, configurable: true } : undefined),
  });
  // Which tree holds a top-level key: the instance's for a scope it owns, the study's for any other.
  const at = (key: string): StateTree => (owns(key) ? own : study);
  const tree: StateTree = new Proxy({}, {
    get: (_target, key) => (key === '_meta' ? meta : typeof key === 'string' ? at(key)[key] : undefined),
    set: (_target, key, value) => {
      // `_meta` is the walk's own: changed through its quantities, never replaced.
      if (typeof key === 'string' && key !== '_meta') at(key)[key] = value;
      return true;
    },
    deleteProperty: (_target, key) => (typeof key === 'string' && key !== '_meta' ? delete at(key)[key] : true),
    has: (_target, key) => key === '_meta' || (typeof key === 'string' && key in at(key)),
    ownKeys: () => [...new Set(['_meta', ...Object.keys(study).filter((key) => key !== '_meta' && !owns(key)), ...Object.keys(own).filter((key) => key !== '_meta')])],
    getOwnPropertyDescriptor: (_target, key): PropertyDescriptor | undefined =>
      (typeof key === 'string' && key in tree ? { value: tree[key], writable: true, enumerable: true, configurable: true } : undefined),
  });
  return tree;
}

/** The values one pool instance holds: the ids `holds` names in `own`, every other in `study`'s. */
class InstanceHeld extends Map<string, unknown> {
  private readonly study: Map<string, unknown>;
  private readonly own: Map<string, unknown>;
  private readonly holds: (id: string) => boolean;

  constructor(study: Map<string, unknown>, own: Map<string, unknown>, holds: (id: string) => boolean) {
    super();
    this.study = study;
    this.own = own;
    this.holds = holds;
  }

  override get(id: string): unknown {
    return this.holds(id) ? this.own.get(id) : this.study.get(id);
  }

  override has(id: string): boolean {
    return this.holds(id) ? this.own.has(id) : this.study.has(id);
  }

  /** An instance's own value reaches the study's too: what the run ends holding is the last written. */
  override set(id: string, value: unknown): this {
    if (this.holds(id)) this.own.set(id, value);
    this.study.set(id, value);
    return this;
  }

  override delete(id: string): boolean {
    return this.holds(id) ? this.own.delete(id) : this.study.delete(id);
  }

  override get size(): number {
    return [...this.entries()].length;
  }

  override *entries(): MapIterator<[string, unknown]> {
    yield* this.own.entries();
    for (const entry of this.study) if (!this.holds(entry[0])) yield entry;
  }

  override [Symbol.iterator](): MapIterator<[string, unknown]> {
    return this.entries();
  }
}

/** A property of `scope` in `state` written, or cleared with no `value`. */
function put(state: StateTree, scope: string, name: string, value: [unknown?]): void {
  const held = (state[scope] ??= {});
  if (value.length > 0) held[name] = value[0];
  else delete held[name];
}

/** What `fields` lead to inside `value`, undefined where one is missing. */
function dig(value: unknown, fields: string[]): unknown {
  let at = value;
  for (const field of fields) {
    if (at === null || typeof at !== 'object') return undefined;
    at = (at as Record<string, unknown>)[field];
  }
  return at;
}
