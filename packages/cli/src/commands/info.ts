import { primaryRoots } from '@core/document';
import { parseSource, readSource, type StudyflowSource } from '@cli/studyfile';

export type StudyInfo = {
  file: { container: StudyflowSource['container']; kind: StudyflowSource['kind'] };
  study: { id?: string; name?: string; version?: string; documentation?: string };
  /** `bpmn:FlowElement` counts by `$type`, subprocesses included. */
  elements: Record<string, number>;
  warnings: string[];
};

function firstDocumentation(element: any): string | undefined {
  const text = element?.documentation?.[0]?.text;
  return typeof text === 'string' && text.trim() ? text.trim() : undefined;
}

export async function info(input: string): Promise<StudyInfo> {
  const source = await readSource(input);
  const { definitions, warnings } = await parseSource(source);

  const root = primaryRoots(definitions)[0];
  const elements: Record<string, number> = {};
  const count = (container: any): void => {
    for (const el of container?.flowElements ?? []) {
      elements[el.$type] = (elements[el.$type] ?? 0) + 1;
      if (el.flowElements) count(el);
    }
  };
  count(root);

  return {
    file: { container: source.container, kind: source.kind },
    study: {
      id: root?.id,
      name: root?.name,
      version: typeof root?.version === 'string' ? root.version : undefined,
      documentation: firstDocumentation(root),
    },
    elements,
    warnings,
  };
}
