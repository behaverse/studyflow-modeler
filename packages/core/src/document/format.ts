import { getProperty, type ModdleElement } from '@core/element/moddle';

export type YamlDoc = Record<string, unknown>;

export const RESERVED_DOC_KEYS = new Set(['id', 'definitions', 'elements', 'layout', 'diagram', 'state']);

export const STUDY_EXTENSION_TYPE = 'studyflow:Study';

/** A collaboration with no pool, only actors that take bands: it holds participants for the process and draws nothing. */
export function isHeadlessCollaboration(root: any): boolean {
  return root?.$type === 'bpmn:Collaboration' && !(root.participants ?? []).some((p: any) => p?.processRef);
}

/** Where the study is meant to run: `runtime` on the `studyflow:Study` extension of the primary root. Unset, the schema says `local`. */
export function declaredRuntime(definitions: ModdleElement | null | undefined): string {
  const value = getProperty(studyExtensionOf(definitions), 'runtime');
  return typeof value === 'string' && value ? value : 'local';
}

/** The `studyflow:Study` extension of the primary root: where `runtime`, `state`, and the study's own fields live. */
export function studyExtensionOf(definitions: ModdleElement | null | undefined): ModdleElement | undefined {
  const root: any = primaryRoot(definitions);
  return root?.extensionElements?.values?.find((ext: any) => ext?.$type === STUDY_EXTENSION_TYPE);
}

/** The study's root: the element the DI plane names (it is what the canvas draws) unless that is a collaboration
 * without a process; else the root {@link inferredRoot} picks. */
export function primaryRoot(definitions: ModdleElement | null | undefined): ModdleElement | undefined {
  const named = definitions?.diagrams?.[0]?.plane?.bpmnElement;
  if (named && !isHeadlessCollaboration(named)) return named;
  return inferredRoot(definitions);
}

/** The root a document whose plane names none draws: the first collaboration with a process, then the first process,
 * then the first choreography; else the first root with an id, of any kind. */
export function inferredRoot(definitions: ModdleElement | null | undefined): ModdleElement | undefined {
  const roots: ModdleElement[] = definitions?.rootElements ?? [];
  const isType = (root: any, type: string) => (root?.$instanceOf ? root.$instanceOf(type) : root?.$type === type);
  for (const type of ['bpmn:Collaboration', 'bpmn:Process', 'bpmn:Choreography']) {
    const root = roots.find((candidate) => isType(candidate, type) && !isHeadlessCollaboration(candidate));
    if (root) return root;
  }
  return roots.find((root) => typeof root?.id === 'string');
}

/** Rewrites parsed definitions in place and says whether it changed anything; `onWarning` hears what it drops. */
export type XmlPass = (definitions: any, onWarning?: (message: string) => void) => boolean;

/**
 * Drops every element from a namespace no loaded schema declares, which moddle keeps as a generic element (Camunda's
 * `camunda:inputOutput` inside `extensionElements`, say). YAML has no spelling for one: a document holding it could be
 * saved but not read back. An `extensionElements` the drop empties goes too.
 */
export const dropForeignElements: XmlPass = (definitions, onWarning) => {
  let dropped = false;
  const visit = (el: any): void => {
    for (const p of el.$descriptor?.properties ?? []) {
      if (p.isReference) continue;
      const value = el[p.name];
      for (const child of Array.isArray(value) ? [...value] : [value]) {
        if (!child?.$descriptor) continue;
        if (!child.$descriptor.isGeneric) {
          visit(child);
          continue;
        }
        const owner = el.$type === 'bpmn:ExtensionElements' ? el.$parent : el;
        onWarning?.(`${owner?.id ?? owner?.$type}: <${child.$type}> is from a namespace no loaded schema declares, and was dropped`);
        if (Array.isArray(value)) value.splice(value.indexOf(child), 1);
        else el.set(p.name, undefined);
        if (el.$type === 'bpmn:ExtensionElements' && value.length === 0) el.$parent?.set('extensionElements', undefined);
        dropped = true;
      }
    }
  };
  visit(definitions);
  return dropped;
};

export async function applyXmlPasses(
  xml: string,
  moddle: {
    fromXML(xml: string): Promise<{ rootElement: any; warnings: unknown[] }>;
    toXML(element: any, options?: { format?: boolean }): Promise<{ xml: string }>;
  },
  passes: XmlPass[],
  onWarning?: (warning: unknown) => void,
): Promise<string> {
  if (passes.length === 0) return xml;

  const { rootElement, warnings } = await moddle.fromXML(xml);
  for (const warning of warnings) onWarning?.(warning);
  let changed = false;
  for (const pass of passes) {
    // Not `changed ||= pass(...)`: every pass must run, and `||=` short-circuits.
    if (pass(rootElement, onWarning)) changed = true;
  }
  if (!changed) return xml;

  return (await moddle.toXML(rootElement, { format: true })).xml;
}
