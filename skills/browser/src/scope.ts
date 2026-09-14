export type PropertyDecl = {
  id: string;
  name: string;
  itemType?: string;
  dataState?: string;
  /** `studyflow:value`, parsed as JSON when it parses, else the literal text. */
  value?: unknown;
  /** Set by the Parameters wired into the sub-process: its value holds for the whole instance, and nothing writes it. */
  readOnly?: boolean;
};

/** A `bpmn:Process` or `bpmn:SubProcess` and the properties it declares. */
export type Scope = {
  id: string;
  parentId?: string;
  startId?: string;
  properties: PropertyDecl[];
};

export class ScopeChain {
  private frames: Array<{ scope: Scope; values: Map<string, unknown> }> = [];
  private undeclaredNames = new Set<string>();

  constructor(root: Scope) {
    this.push(root);
  }

  push(scope: Scope): void {
    this.frames.push({ scope, values: new Map() });
  }

  pop(): void {
    if (this.frames.length > 1) this.frames.pop();
  }

  read(name: string): unknown {
    for (let i = this.frames.length - 1; i >= 0; i -= 1) {
      const frame = this.frames[i];
      if (frame.values.has(name)) return frame.values.get(name);
    }
    return undefined;
  }

  /** Writes to the innermost frame declaring `name` (the root when none does) and returns that scope's id; `seeding`
   * is the frame taking its declared values as it starts, the one write a read-only property takes. */
  write(name: string, value: unknown, seeding = false): string {
    for (let i = this.frames.length - 1; i >= 0; i -= 1) {
      const frame = this.frames[i];
      const decl = frame.scope.properties.find((p) => p.name === name);
      if (decl) {
        if (decl.readOnly && !seeding) {
          throw new Error(`'${name}' is set by the Parameters wired into ${frame.scope.id}, so nothing inside it writes it.`);
        }
        frame.values.set(name, value);
        return frame.scope.id;
      }
    }
    this.undeclaredNames.add(name);
    this.frames[0].values.set(name, value);
    return this.frames[0].scope.id;
  }

  undeclared(): string[] {
    return [...this.undeclaredNames];
  }

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
