import * as yaml from 'js-yaml';

import { getProperty, type ModdleElement } from '@core/element/moddle';

export type YamlDoc = Record<string, unknown>;

export const RESERVED_DOC_KEYS = new Set(['id', 'definitions', 'elements', 'diagram']);

export const YAML_DUMP_OPTIONS: yaml.DumpOptions = { noRefs: true, lineWidth: 120, quotingType: '"' };

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
  add(definitions?.diagrams?.[0]?.plane?.bpmnElement);
  for (const type of ['bpmn:Collaboration', 'bpmn:Process', 'bpmn:Choreography']) {
    for (const root of roots) if (isType(root, type)) add(root);
  }
  for (const root of roots) if (typeof root?.id === 'string') add(root);
  return ordered;
}

/**
 * Where the study is meant to run. The inspector stores `runtime` on the `studyflow:Study` extension of the
 * process; a bare attribute on the process itself is how older files spelled it. Unset, the schema says `cloud`.
 */
export function declaredRuntime(definitions: ModdleElement | null | undefined): string {
  const root: any = primaryRoots(definitions)[0];
  const study = root?.extensionElements?.values?.find((ext: any) => ext?.$type === 'studyflow:Study');
  const value = getProperty(study, 'runtime') ?? root?.runtime ?? root?.$attrs?.runtime ?? root?.$attrs?.['studyflow:runtime'];
  return typeof value === 'string' && value ? value : 'cloud';
}

export function inferPlaneRoot(definitions: ModdleElement | null | undefined): ModdleElement | undefined {
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

export function hasOnlyProperties(el: ModdleElement, keepNames: string[]): boolean {
  for (const p of el.$descriptor?.properties ?? []) {
    if (keepNames.includes(p.name)) continue;
    const value = el[p.name];
    if (value === undefined || value === null) continue;
    if (p.default !== undefined && value === p.default) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    return false;
  }
  return true;
}

export function valueTypeOf(prop: any): string | undefined {
  return prop.valueType ?? prop.type;
}

export function isPrimitiveTypeRef(type: string): boolean {
  return ['String', 'Boolean', 'Integer', 'Real', 'Element'].includes(type);
}
