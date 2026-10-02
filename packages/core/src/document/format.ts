export const STUDY_EXTENSION_TYPE = 'studyflow:Study';

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
