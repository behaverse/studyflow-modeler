// Launch the runner in a new tab. The diagram is handed off via localStorage


const DEFAULT_SEED = 42;

export type OpenRunnerCommand = {
  type: 'open-runner';
  seed?: number;
};

export async function runOpenRunner(modeler: any, command: OpenRunnerCommand): Promise<void> {
  const { xml } = await modeler.saveXML({ format: true });
  // Short, git-hash-style id
  const diagramId = crypto.randomUUID().slice(0, 8);
  localStorage.setItem(diagramId, xml);

  const params = new URLSearchParams({
    diagram_id: diagramId,
    seed: String(command.seed ?? DEFAULT_SEED),
  });

  window.open(`./run.html?${params.toString()}`, '_blank', 'noopener');
}
