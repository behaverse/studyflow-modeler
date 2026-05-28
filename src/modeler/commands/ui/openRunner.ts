// Hand off the diagram to the Runner via localStorage; Blob URLs don't survive `noopener` popups.

const DEFAULT_SEED = 42;

export type OpenRunnerCommand = {
  type: 'open-runner';
  seed?: number;
};

export async function runOpenRunner(modeler: any, command: OpenRunnerCommand): Promise<void> {
  const { xml } = await modeler.saveXML({ format: true });
  const diagramId = `studyflow-${crypto.randomUUID()}`;
  localStorage.setItem(diagramId, xml);
  const params = new URLSearchParams({
    diagram_id: diagramId,
    seed: String(command.seed ?? DEFAULT_SEED),
  });
  window.open(`./run.html?${params.toString()}`, '_blank', 'noopener');
}
