import * as yaml from 'js-yaml';

import { getProperty, type ModdleElement } from '@core/element/moddle';

export type YamlDoc = Record<string, unknown>;

export const RESERVED_DOC_KEYS = new Set(['id', 'definitions', 'elements', 'diagram', 'state']);

export const STUDY_EXTENSION_TYPE = 'studyflow:Study';

export const YAML_DUMP_OPTIONS: yaml.DumpOptions = { noRefs: true, lineWidth: 120, quotingType: '"' };

/** A collaboration with no pool, only actors that take bands: it holds participants for the process and draws nothing. */
export function isHeadlessCollaboration(root: any): boolean {
  return root?.$type === 'bpmn:Collaboration' && !(root.participants ?? []).some((p: any) => p?.processRef);
}

/** Every `bpmn:RootElement` that could be the diagram's subject, best candidate first. */
export function primaryRoots(definitions: ModdleElement | null | undefined): ModdleElement[] {
  const roots: ModdleElement[] = definitions?.rootElements ?? [];
  const isType = (root: any, type: string) => (
    root?.$instanceOf ? root.$instanceOf(type) : root?.$type === type
  );

  const ordered: ModdleElement[] = [];
  const add = (root: ModdleElement | undefined) => {
    if (root && !ordered.includes(root)) ordered.push(root);
  };

  // The element the DI plane names outranks any type preference: it is what the canvas draws.
  const named = definitions?.diagrams?.[0]?.plane?.bpmnElement;
  if (!isHeadlessCollaboration(named)) add(named);
  for (const type of ['bpmn:Collaboration', 'bpmn:Process', 'bpmn:Choreography']) {
    for (const root of roots) if (isType(root, type) && !isHeadlessCollaboration(root)) add(root);
  }
  for (const root of roots) if (typeof root?.id === 'string') add(root);
  return ordered;
}

/** Where the study is meant to run: `runtime` on the `studyflow:Study` extension of the process. Unset, the schema says `cloud`. */
export function declaredRuntime(definitions: ModdleElement | null | undefined): string {
  const value = getProperty(studyExtensionOf(definitions), 'runtime');
  return typeof value === 'string' && value ? value : 'cloud';
}

/** The `studyflow:Study` extension of the primary root: where `runtime`, `state`, and the study's own fields live. */
export function studyExtensionOf(definitions: ModdleElement | null | undefined): ModdleElement | undefined {
  const root: any = primaryRoot(definitions);
  return root?.extensionElements?.values?.find((ext: any) => ext?.$type === STUDY_EXTENSION_TYPE);
}

/** The study's root: the element the DI plane names, else the best candidate `primaryRoots` ranks first. */
export function primaryRoot(definitions: ModdleElement | null | undefined): ModdleElement | undefined {
  return primaryRoots(definitions)[0];
}

export type XmlPass = (definitions: any) => boolean;

export async function applyXmlPasses(
  xml: string,
  moddle: {
    fromXML(xml: string): Promise<{ rootElement: any }>;
    toXML(element: any, options?: { format?: boolean }): Promise<{ xml: string }>;
  },
  passes: XmlPass[],
): Promise<string> {
  if (passes.length === 0) return xml;

  const { rootElement } = await moddle.fromXML(xml);
  let changed = false;
  for (const pass of passes) {
    // Not `changed ||= pass(...)`: every pass must run, and `||=` short-circuits.
    if (pass(rootElement)) changed = true;
  }
  if (!changed) return xml;

  return (await moddle.toXML(rootElement, { format: true })).xml;
}
