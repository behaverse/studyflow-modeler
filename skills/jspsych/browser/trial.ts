import { parseImplementationRef } from '@core/implementation';

/** Where the jsPsych builds come from: the npm packages, as unpkg serves them. */
export const JSPSYCH_CDN = 'https://unpkg.com';

/** The plugin release line that goes with each jsPsych major version: jsPsych 8 runs the 2.x plugins, 7 the 1.x. */
const PLUGIN_MAJOR: Record<string, string> = { 7: '1', 8: '2' };

/** One jsPsych step: which plugin, for which jsPsych, and the files that play it. */
export type JsPsychTrial = {
  plugin: string;
  version: string;
  /** The jsPsych build: its script (it sets `jsPsychModule`) and its stylesheet. */
  core: { script: string; css: string };
  /** The plugin's build, and the global it sets (`jsPsychHtmlKeyboardResponse`). */
  script: string;
  global: string;
};

/** What a `jspsych://<plugin>@<version>` reference plays, the version being jsPsych's; an error says what is wrong. */
export function trialOf(implementation: string | undefined): JsPsychTrial | { error: string } {
  const parsed = parseImplementationRef(implementation);
  if (!parsed.ok) return { error: parsed.error };
  const { scheme, ref: plugin, version } = parsed.value;
  if (scheme !== 'jspsych') return { error: `'${implementation}' is no jspsych:// reference` };
  if (!version) return { error: `'${implementation}' names no jsPsych version: write jspsych://${plugin}@8` };
  const major = PLUGIN_MAJOR[version.split('.')[0]];
  if (!major) return { error: `jsPsych ${version} is not one this runtime plays (${Object.keys(PLUGIN_MAJOR).join(', ')})` };
  const name = plugin.replace(/^plugin-/, '');
  const pascal = name.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('');
  return {
    plugin: name,
    version,
    core: { script: `${JSPSYCH_CDN}/jspsych@${version}/dist/index.browser.min.js`, css: `${JSPSYCH_CDN}/jspsych@${version}/css/jspsych.css` },
    script: `${JSPSYCH_CDN}/@jspsych/plugin-${name}@${major}/dist/index.browser.min.js`,
    global: `jsPsych${pascal}`,
  };
}

/** The keys a timeline node holds for the timeline, not for its trials. */
const TIMELINE_KEYS = new Set(['timeline_variables', 'randomize_order', 'repetitions', 'sample', 'conditional_function', 'loop_function']);

/**
 * The jsPsych timeline one step runs: its Parameters as the plugin's, and, when they carry `timeline_variables`, a
 * timeline over them, each variable a trial parameter unless the Parameters set it. `variable(name)` is jsPsych's
 * `timelineVariable`.
 */
export function timelineOf(plugin: unknown, parameters: Record<string, unknown>, variable: (name: string) => unknown): Record<string, unknown> {
  const trial: Record<string, unknown> = { type: plugin };
  const around: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parameters)) (TIMELINE_KEYS.has(key) ? around : trial)[key] = value;
  const variables = around.timeline_variables;
  if (!Array.isArray(variables) || variables.length === 0) return trial;
  for (const name of Object.keys(variables[0] as Record<string, unknown>)) if (!(name in trial)) trial[name] = variable(name);
  return { ...around, timeline: [trial] };
}
