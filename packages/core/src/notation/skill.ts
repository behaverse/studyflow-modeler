import * as yaml from 'js-yaml';

/** The skills the modeler and the local runtime rely on to run BPMN at all; they load always and cannot be disabled. */
export const CORE_SKILLS: ReadonlySet<string> = new Set(['studyflow', 'prov', 'cognitive']);

/** Where a skill keeps the `.studyflow.png` diagrams it ships for the gallery. */
export const EXAMPLES_FOLDER = 'examples';

/** A skill's manifest, read from the YAML front matter of its `SKILL.md`. The file follows the Agent
 * Skills specification (https://agentskills.io/specification): `name`, `description`, and optional
 * `license`, `compatibility` (the runtime environment a runner needs), `metadata`, `allowed-tools`. What
 * the skill contributes to studyflow is declared under `metadata`, whose values are strings; nothing is
 * found by file name. What can be inferred is not declared: `examples/` is always the examples folder,
 * the core skills are known here, and a skill is listed by its name. */
export type SkillManifest = {
  /** The folder's name, and the runner's (`--runner reachy=…`, `STUDYFLOW_REACHY_PY`). */
  name: string;
  description: string;
  /** `schema`: the BPMN extension the skill contributes (a `*.moddle.yaml`), relative to its folder. */
  schema?: string;
  /** `runtimes.<runtime>`: what the skill gives each runtime (the names the study's `runtime` attribute uses) to
   * execute its elements, in any language. For `local` a command run in the skill's folder following the
   * partial-runner contract; for `browser` a module the browser runtime imports. The `prov` skill's `local`
   * entry is the module the local runtime loads in-process for its records instead. */
  runtimes?: Record<string, string>;
  /** `modeler`: a module the modeler imports (`modeler.ts`), exporting the projections it writes and the foreign formats it opens. */
  modelerModule?: string;
};

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---/;
/** The specification's `name`: 1-64 lowercase alphanumerics and single hyphens, not at either end. */
const NAME = /^(?!-)(?!.*--)[a-z0-9-]{1,64}(?<!-)$/;

/** `folder` is the skill's directory when the caller knows it; the specification wants `name` to match it. A
 * runtime whose own root is a skill folder (the browser runtime) sees its manifest as `/SKILL.md` and passes none. */
export function parseSkillManifest(markdown: string, folder?: string): SkillManifest {
  const match = markdown.match(FRONT_MATTER);
  if (!match) throw new Error(`SKILL.md in ${folder ?? '?'}/ has no YAML front matter`);
  const data = (yaml.load(match[1]) ?? {}) as Record<string, unknown>;
  const name = String(data.name ?? '');
  if (!NAME.test(name)) throw new Error(`SKILL.md in ${folder ?? name}/: name "${name}" is not lowercase alphanumerics and hyphens`);
  if (folder !== undefined && name !== folder) throw new Error(`SKILL.md in ${folder}/ names itself "${name}"; the folder is the name.`);
  const description = String(data.description ?? '').trim();
  if (!description || description.length > 1024) throw new Error(`SKILL.md in ${name}/: description is empty or over 1024 characters`);

  const meta = (data.metadata ?? {}) as Record<string, unknown>;
  const byRuntime = (key: string): Record<string, string> | undefined => {
    const map = meta[key];
    if (!map || typeof map !== 'object') return undefined;
    return Object.fromEntries(Object.entries(map as Record<string, unknown>).map(([runtime, value]) => [runtime, String(value)]));
  };
  return {
    name,
    description,
    schema: meta.schema === undefined ? undefined : String(meta.schema),
    runtimes: byRuntime('runtimes'),
    modelerModule: meta['modeler'] === undefined ? undefined : String(meta['modeler']),
  };
}

export function isCoreSkill(name: string): boolean {
  return CORE_SKILLS.has(name);
}
