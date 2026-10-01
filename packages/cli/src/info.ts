import { protocolDigest } from '@core/document';
import { isElement, type Element, type Value } from '@core/model/index';
import { parseSource, readSource, type StudyflowSource } from '@cli/studyfile';

export type StudyInfo = {
  file: { container: StudyflowSource['container']; kind: StudyflowSource['kind'] };
  study: { id?: string; name?: string; version?: string; documentation?: string };
  /** The protocol digest a run records as its `plan` (`sha256:…`). */
  protocol: string;
  /** Flow element counts by the BPMN element each is, subprocesses' included. */
  elements: Record<string, number>;
  warnings: string[];
};

const text = (value: Value | undefined): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

/** An element's first documentation: its text, or the first of a list. */
function firstDocumentation(element: Element | undefined): string | undefined {
  const documentation = element?.documentation;
  const first = Array.isArray(documentation) ? documentation[0] : documentation;
  return text(isElement(first) ? first.text : first);
}

export async function info(input: string): Promise<StudyInfo> {
  const source = await readSource(input);
  const { model, warnings } = await parseSource(source);

  const root = model.primaryRoot();
  const elements: Record<string, number> = {};
  const count = (container: Element | undefined): void => {
    for (const element of Array.isArray(container?.flowElements) ? container.flowElements.filter(isElement) : []) {
      const type = model.host(element);
      elements[type] = (elements[type] ?? 0) + 1;
      if (element.flowElements) count(element);
    }
  };
  // Every pool's process, or the one process a study of one pool is.
  const processes = model.study.roots.filter((element) => model.host(element) === 'bpmn:Process');
  for (const process of processes.length > 0 ? processes : [root]) count(process);

  return {
    file: { container: source.container, kind: source.kind },
    study: {
      id: root?.id,
      name: text(root?.name),
      version: text(model.studyOf(root)?.version),
      documentation: firstDocumentation(root),
    },
    protocol: await protocolDigest(model),
    elements,
    warnings,
  };
}
