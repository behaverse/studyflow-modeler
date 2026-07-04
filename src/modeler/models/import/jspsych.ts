/**
 * jsPsych -> Studyflow importer (one-way).
 *
 * Maps a jsPsych timeline into an intermediate `ImportedStudy`: each timeline
 * node becomes a `cognitive:CognitiveTask` with `instrument="jspsych"`, a
 * versioned function reference (`jspsych://<plugin>@<version>`, the grammar
 * `functionRef.ts` parses), and the node's remaining parameters carried as
 * inline `configurations`. A leading consent node is folded into the study's
 * start event (`studyflow:consentFormUri`) rather than emitted as a task.
 *
 * This module is pure: it turns jsPsych data into the intermediate model and
 * never touches moddle or bpmn-js. `studyflowDocument.ts` assembles the model
 * into a `.studyflow` file (events, sequence flows, auto-layout).
 *
 * `functionRef` is the versioned reference to the software that implements a
 * task (`<scheme>://<ref>[@<version>]`, the grammar `parseFunctionRef` reads).
 * The builder writes it to the general-purpose `studyflow:uses` activity
 * attribute, which spans any implementation kind - a jsPsych plugin
 * (`jspsych://...`), a container image (`docker://...`), a script URL
 * (`https://...`), an importable callable (`python://...`), and so on. The
 * field is named `functionRef` for the concept (as the runner does); the wire
 * attribute is `uses`.
 */

import { parseFunctionRef } from '@/core/functionRef';

/** A single jsPsych timeline entry (a trial or a nested procedure). */
export type JsPsychNode = Record<string, unknown>;

/**
 * Accepted import inputs: a bare timeline array, a jsPsych experiment object
 * carrying a `timeline`, or a JSON string encoding either. A "JS module" is
 * imported by the caller and its exported timeline passed here directly.
 */
export type JsPsychTimelineInput = JsPsychNode[] | { timeline?: JsPsychNode[]; [k: string]: unknown } | string;

export type JsPsychImportOptions = {
  /** `bpmn:Definitions` id (and default study/process id stem). */
  id?: string;
  /** Human-readable study name. */
  name?: string;
  /**
   * Default version stamped into every function reference when a node does not
   * declare its own (`type.info.version`). jsPsych timelines rarely carry
   * plugin versions, so pass the real one you built against. Defaults to `"8"`.
   */
  jsPsychVersion?: string;
  /** Per-plugin version overrides, keyed by normalized plugin id. */
  pluginVersions?: Record<string, string>;
  /** Detect and fold a leading consent node into the start event. Default true. */
  detectConsent?: boolean;
  /**
   * Consent form URI for the start event. Overrides anything detected on the
   * consent node; when set, a start-event consent link is emitted even if the
   * timeline has no recognizable consent node.
   */
  consentFormUri?: string;
  /**
   * Custom function-reference resolver. Return a `<scheme>://<ref>[@<version>]`
   * string to override the default `jspsych://<plugin>@<version>` (e.g. to
   * point at a curated jspsych-contrib release). Returning `undefined` falls
   * back to the default.
   */
  functionRef?: (ctx: { node: JsPsychNode; pluginId: string; version: string; index: number }) => string | undefined;
};

export type ImportedTask = {
  /** Sanitized, unique BPMN id. */
  id: string;
  /** Human-readable label (`bpmn:name`). */
  name: string;
  instrument: 'jspsych';
  /** `<scheme>://<ref>[@<version>]`, validated against the `uses` grammar. */
  functionRef: string;
  /** Inline configuration (serialized to the `configurations` YAML body). */
  configurations: Record<string, unknown>;
};

export type ImportedStudy = {
  /** `bpmn:Definitions` id. */
  id: string;
  /** Study name (`bpmn:Process` name). */
  name: string;
  /** `bpmn:Process` id. */
  processId: string;
  /** Present when a consent node was folded in or an override was supplied. */
  consentFormUri?: string;
  /** One cognitive task per timeline node, in order. */
  tasks: ImportedTask[];
  /** Non-fatal notes (dropped function-valued params, missing plugin types, ...). */
  warnings: string[];
};

const DEFAULT_VERSION = '8';

/** jsPsych config keys that describe the node rather than its parameters. */
const OMITTED_CONFIG_KEYS = new Set(['type']);

/** Normalize an import input into a flat, ordered list of timeline nodes. */
export function parseTimeline(input: JsPsychTimelineInput): JsPsychNode[] {
  let value: unknown = input;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch (error) {
      throw new Error(`jsPsych import: input is not valid JSON (${(error as Error).message}).`);
    }
  }

  // Guard against JSON that happens to parse but is not a timeline (the UI
  // lets users pick any `.json`): every entry must be a trial-shaped object.
  const asNodes = (entries: unknown[]): JsPsychNode[] => {
    if (entries.length === 0 || !entries.every((n) => n && typeof n === 'object' && !Array.isArray(n))) {
      throw new Error('jsPsych import: this JSON does not look like a jsPsych timeline (expected a non-empty array of trial objects).');
    }
    return entries as JsPsychNode[];
  };

  if (Array.isArray(value)) return asNodes(value);
  if (value && typeof value === 'object' && Array.isArray((value as { timeline?: unknown }).timeline)) {
    return asNodes((value as { timeline: unknown[] }).timeline);
  }
  throw new Error('jsPsych import: expected a timeline array or an object with a `timeline` array.');
}

/** `HtmlKeyboardResponse` -> `html-keyboard-response`; leaves kebab/scoped ids intact. */
function camelToKebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/**
 * Resolve a jsPsych plugin id from a node's `type`, which may be a plugin
 * object (`{ info: { name } }`), a class name (`jsPsychHtmlKeyboardResponse`),
 * a kebab id (`html-keyboard-response`), or an npm package
 * (`@jspsych/plugin-html-keyboard-response`).
 */
function pluginIdOf(node: JsPsychNode): { id: string; version?: string } | undefined {
  const type = node.type;

  if (type && typeof type === 'object') {
    const info = (type as { info?: { name?: unknown; version?: unknown } }).info;
    const name = typeof info?.name === 'string' ? info.name : undefined;
    const version = typeof info?.version === 'string' ? info.version : undefined;
    if (name) return { id: name, version };
    return undefined;
  }

  if (typeof type === 'string' && type.trim()) {
    const raw = type.trim();
    // Scoped npm package or already-kebab id: keep verbatim.
    if (raw.startsWith('@') || raw.includes('/') || (!/[A-Z]/.test(raw) && raw.includes('-'))) {
      return { id: raw };
    }
    // `jsPsychHtmlKeyboardResponse` -> `html-keyboard-response`.
    const stripped = raw.replace(/^jsPsych/, '');
    return { id: camelToKebab(stripped) };
  }

  return undefined;
}

/** True for a node that presents a consent form (folded into the start event). */
function looksLikeConsent(node: JsPsychNode): boolean {
  if (node.consent === true) return true;

  const haystacks: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string') haystacks.push(v.toLowerCase());
  };
  const plugin = pluginIdOf(node);
  if (plugin) push(plugin.id);
  push(node.name);
  const data = node.data;
  if (data && typeof data === 'object') push((data as { task?: unknown }).task);
  push(node.stimulus);
  push(node.preamble);

  return haystacks.some((h) => h.includes('consent'));
}

/** Best-effort consent-document URI from a consent node. */
function consentUriOf(node: JsPsychNode): string | undefined {
  for (const key of ['consentFormUri', 'consent_url', 'url', 'href']) {
    const value = node[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/** Build and validate a `jspsych://<plugin>@<version>` reference. */
function buildFunctionRef(pluginId: string, version: string): string {
  const ref = `jspsych://${pluginId}@${version}`;
  const parsed = parseFunctionRef(ref);
  if (!parsed.ok) {
    throw new Error(`jsPsych import: could not build a function reference from "${pluginId}@${version}": ${parsed.error}`);
  }
  return ref;
}

/** Sanitize a label into a BPMN NCName stem (`Flanker test` -> `Flanker_test`). */
function sanitizeIdStem(label: string): string {
  const cleaned = label.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const stem = cleaned || 'Task';
  return /^[A-Za-z]/.test(stem) ? stem : `Task_${stem}`;
}

/** `Flanker demo` -> `FlankerDemo`; used for the process id (distinct from the definitions id). */
function toPascalCase(label: string): string {
  const words = label.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const joined = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  const stem = joined || 'Study';
  return /^[A-Za-z]/.test(stem) ? stem : `Study_${stem}`;
}

function humanize(pluginId: string): string {
  const base = pluginId.split('/').pop() ?? pluginId;
  const words = base.replace(/^plugin-/, '').split('-').filter(Boolean);
  if (words.length === 0) return 'Task';
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Strip node metadata and non-serializable (function) params; collect warnings. */
function extractConfig(node: JsPsychNode, nodeLabel: string, warnings: string[]): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (OMITTED_CONFIG_KEYS.has(key)) continue;
    if (typeof value === 'function') {
      warnings.push(`${nodeLabel}: dropped function-valued parameter "${key}" (not serializable to configurations).`);
      continue;
    }
    config[key] = value;
  }
  return config;
}

/**
 * Convert a jsPsych timeline into the intermediate `ImportedStudy`. Pure; no
 * moddle/bpmn-js. Feed the result to `buildStudyflowXml` for a `.studyflow`.
 */
export function importJsPsychTimeline(input: JsPsychTimelineInput, options: JsPsychImportOptions = {}): ImportedStudy {
  const nodes = parseTimeline(input);
  const warnings: string[] = [];

  const id = options.id ?? 'jspsych_import';
  const name = options.name ?? 'Imported jsPsych study';
  // The process id must differ from the definitions id, or moddle's id registry
  // rejects the second element with that id on load.
  let processId = toPascalCase(name);
  if (processId === id) processId = `${processId}_Process`;
  const detectConsent = options.detectConsent ?? true;

  let consentFormUri = options.consentFormUri;
  let taskNodes = nodes;
  if (detectConsent && nodes.length > 0 && looksLikeConsent(nodes[0])) {
    if (consentFormUri === undefined) consentFormUri = consentUriOf(nodes[0]) ?? 'consent.md';
    taskNodes = nodes.slice(1);
  }

  const usedIds = new Set<string>();
  const uniqueId = (stem: string): string => {
    let candidate = stem;
    let n = 2;
    while (usedIds.has(candidate)) candidate = `${stem}_${n++}`;
    usedIds.add(candidate);
    return candidate;
  };

  const tasks: ImportedTask[] = taskNodes.map((node, index) => {
    const plugin = pluginIdOf(node);
    let pluginId = plugin?.id;
    if (!pluginId) {
      // A grouping node (nested `timeline`) or a node with no resolvable type.
      pluginId = Array.isArray(node.timeline) ? 'timeline' : 'unknown';
      warnings.push(
        `Node ${index + 1}: no resolvable plugin \`type\`; used "${pluginId}" for the function reference.`,
      );
    }

    const declaredName = typeof node.name === 'string' && node.name.trim() ? node.name.trim() : undefined;
    const label = declaredName ?? humanize(pluginId);
    const taskId = uniqueId(sanitizeIdStem(label));

    const version = options.pluginVersions?.[pluginId] ?? plugin?.version ?? options.jsPsychVersion ?? DEFAULT_VERSION;
    const custom = options.functionRef?.({ node, pluginId, version, index });
    const functionRef = custom && custom.trim() ? custom.trim() : buildFunctionRef(pluginId, version);

    const parsed = parseFunctionRef(functionRef);
    if (!parsed.ok) {
      throw new Error(`jsPsych import: invalid function reference "${functionRef}" for node ${index + 1}: ${parsed.error}`);
    }

    return {
      id: taskId,
      name: label,
      instrument: 'jspsych' as const,
      functionRef,
      configurations: extractConfig(node, label, warnings),
    };
  });

  return { id, name, processId, consentFormUri, tasks, warnings };
}
