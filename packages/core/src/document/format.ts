import type { ModdleElement } from '@core/document/moddle';

export const STUDY_EXTENSION_TYPE = 'studyflow:Study';

/** A collaboration with no pool, only actors that take bands: it holds participants for the process and draws nothing. */
export function isHeadlessCollaboration(root: any): boolean {
  return root?.$type === 'bpmn:Collaboration' && !(root.participants ?? []).some((p: any) => p?.processRef);
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
 * Drops every element from a namespace no loaded schema declares that YAML cannot spell: moddle keeps one as a generic
 * element, and YAML spells it by its attributes and its children's texts, so one whose children have attributes or
 * children of their own (Camunda's `camunda:inputOutput`, say) could be saved but not read back. An
 * `extensionElements` the drop empties goes too.
 */
export const dropForeignElements: XmlPass = (definitions, onWarning) => {
  let dropped = false;
  const spellable = (el: any): boolean => (el.$children ?? []).every((child: any) =>
    !child.$children?.length && Object.keys(child).every((key) => key.startsWith('$')));
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
        if (spellable(child)) continue;
        const owner = el.$type === 'bpmn:ExtensionElements' ? el.$parent : el;
        onWarning?.(`${owner?.id ?? owner?.$type}: <${child.$type}> is from a namespace no loaded schema declares, and holds more than YAML spells of one; it was dropped`);
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
