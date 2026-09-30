import { evaluateFeel } from '@core/expression/feel';
import type { Graph } from '@core/engine/graph';
import type { Note, StateTree } from '@core/engine/host';
import type { Expression, PlanElement } from '@core/engine/plan';
import type { Happening } from '@core/engine/record';

/**
 * What a run holds: the `state` tree (`state.<scope>.<property>`, and `state._meta`, the walk's own), what each
 * element produced this run, and the order the walk reached them in. Every expression reads from here.
 */
export class Values {
  readonly state: StateTree;
  readonly trace: string[] = [];
  /** What each element produced this run, by id. */
  readonly held = new Map<string, unknown>();
  private readonly graph: Graph;
  /** Every change to the state is an event of the run's record, which the state can be recovered from. */
  private readonly record: (happened: Happening) => void;

  constructor(graph: Graph, state: StateTree, record: (happened: Happening) => void = () => undefined) {
    this.graph = graph;
    this.state = state;
    this.record = record;
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
    this.record({ event: 'instance', id, instance: pass });
  }

  /** A property of `scope` written, or cleared with no `value`. */
  set(scope: string, name: string, ...value: [unknown?]): void {
    const held = (this.state[scope] ??= {});
    if (value.length > 0) held[name] = value[0];
    else delete held[name];
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
    const { value, error } = evaluateFeel(expression.body, { ...this.namespace(), ...(scope ? this.scopeValues(scope) : {}), ...extra });
    if (error) throw new Error(error);
    return value;
  }

  /** Initialise the scope's properties from `value`; `reset` re-initialises ones the tree already holds. */
  startScope(id: string, reset: boolean, note: Note): void {
    for (const [name, declared] of this.graph.properties.get(id) ?? []) {
      if (declared.value === undefined) continue;
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
