import type { PropertyDecl, Scope } from '@/runner/models/flow';

/**
 * The run's state, as a stack of scope instances.
 *
 * Variables are not an ambient bag: each is a `bpmn:Property` declared by a
 * container, and the container's instance bounds its lifetime (BPMN 2.0
 * §10.4.7). Entering a sub-process opens a frame and leaving closes it, so a
 * repeated block — a trial, a session, a fold — starts from its declarations
 * again instead of inheriting whatever the previous pass left behind.
 *
 * A read walks outward from the innermost frame, so a trial sees the study's
 * allocated arm without that value being copied into it, and an inner
 * declaration of the same name shadows an outer one. A write lands on the
 * innermost frame that *declares* the name; that is what makes a write
 * addressable rather than ambient.
 *
 * Names the diagram never declares (a runner-issued completion code, a
 * questionnaire response keyed by instrument) are still accepted, and land on
 * the root frame. They are tracked separately so a caller can tell a declared
 * value from one that merely appeared at run time.
 */
export class ScopeChain {
  /** Innermost frame last; frame 0 is the process scope. */
  private frames: Array<{ scope: Scope; values: Map<string, unknown> }> = [];
  private undeclaredNames = new Set<string>();

  constructor(root: Scope, initial: Record<string, unknown> = {}) {
    this.push(root);
    for (const [name, value] of Object.entries(initial)) this.write(name, value);
  }

  /** Open a scope instance. Its declarations start unset, not inherited. */
  push(scope: Scope): void {
    this.frames.push({ scope, values: new Map() });
  }

  /** Close the innermost scope instance, discarding its values. The root
   *  frame is never popped — a run always has a study scope. */
  pop(): void {
    if (this.frames.length > 1) this.frames.pop();
  }

  get depth(): number {
    return this.frames.length;
  }

  /** Id of the innermost open scope. */
  get currentScopeId(): string | undefined {
    return this.frames[this.frames.length - 1]?.scope.id;
  }

  /** Every declaration visible from the innermost frame, inner shadowing outer. */
  visibleDeclarations(): PropertyDecl[] {
    const byName = new Map<string, PropertyDecl>();
    for (const frame of this.frames) {
      for (const decl of frame.scope.properties) byName.set(decl.name, decl);
    }
    return [...byName.values()];
  }

  /** Whether some open scope declares `name`. */
  declares(name: string): boolean {
    return this.frames.some((frame) => frame.scope.properties.some((p) => p.name === name));
  }

  /** Value of `name`, resolved outward from the innermost frame. */
  read(name: string): unknown {
    for (let i = this.frames.length - 1; i >= 0; i -= 1) {
      const frame = this.frames[i];
      if (frame.values.has(name)) return frame.values.get(name);
    }
    return undefined;
  }

  /**
   * Write `name`, on the innermost frame that declares it. An undeclared name
   * lands on the root frame and is recorded as such.
   */
  write(name: string, value: unknown): void {
    for (let i = this.frames.length - 1; i >= 0; i -= 1) {
      const frame = this.frames[i];
      if (frame.scope.properties.some((p) => p.name === name)) {
        frame.values.set(name, value);
        return;
      }
    }
    this.undeclaredNames.add(name);
    this.frames[0].values.set(name, value);
  }

  /** Names written at run time that no open scope declared. */
  undeclared(): string[] {
    return [...this.undeclaredNames];
  }

  /**
   * Flattened view for expression evaluation and for the session record:
   * every visible name bound to its resolved value, inner shadowing outer.
   * Declared-but-unwritten names are present and undefined, so a condition
   * over them evaluates rather than failing as an unknown reference.
   */
  bindings(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const frame of this.frames) {
      for (const decl of frame.scope.properties) out[decl.name] = undefined;
    }
    for (const frame of this.frames) {
      for (const [name, value] of frame.values) out[name] = value;
    }
    return out;
  }
}
