// Launch the runner in a new tab. The diagram is handed off via localStorage

import { getSettings } from '../../settings/store';

const DEFAULT_SEED = 42;

/** Agent id stamped on sessions created by a modeler test-run. Production runs
 *  launched by the data-server carry a real participant id; modeler runs are
 *  dev/test traffic, so they share one recognizable id. */
const DEFAULT_AGENT_ID = 'modeler-test';

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

  // Forward non-secret data-server config so events can persist
  const { dataServerUrl, studyName } = getSettings();
  if (dataServerUrl && studyName) {
    params.set('data_server_url', dataServerUrl);
    params.set('study_name', studyName);
    params.set('agent_id', DEFAULT_AGENT_ID);
  }

  window.open(`./run.html?${params.toString()}`, '_blank', 'noopener');
}
