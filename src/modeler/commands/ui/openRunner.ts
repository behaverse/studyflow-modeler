// Launch the runner in a new tab, handing off the diagram (and, for online
// runs, the data-server token) through same-origin localStorage rather than the
// URL — see the note in runOpenRunner for why the token must not go in the URL.

import { getSettings, getStoredApiKey } from '../../settings/store';

const DEFAULT_SEED = 42;

/** Agent id stamped on sessions created by a modeler test-run. Production runs
 *  launched by the data-server carry a real participant id; modeler runs are
 *  dev/test traffic, so they share one recognizable id. */
const DEFAULT_AGENT_ID = 'modeler-test';

export type OpenRunnerCommand = {
  type: 'open-runner';
  seed?: number;
};

/** Shape of the localStorage payload the runner reads back under `diagram_id`. */
type RunnerHandoff = {
  xml: string;
  /** Data-server bearer token, kept out of the URL — see below. */
  dataServerApiKey?: string;
};

export async function runOpenRunner(modeler: any, command: OpenRunnerCommand): Promise<void> {
  const { xml } = await modeler.saveXML({ format: true });
  const diagramId = `studyflow-${crypto.randomUUID()}`;
  const handoff: RunnerHandoff = { xml };

  const params = new URLSearchParams({
    diagram_id: diagramId,
    seed: String(command.seed ?? DEFAULT_SEED),
  });

  // Forward the data-server config so a modeler-launched run can persist its
  // session and post telemetry events. The runner only goes online when it has
  // both a base URL and a study name (see `canConnect` in runner/dataServer.ts),
  // so we mirror that: with either unset we omit the whole bundle and the run
  // stays offline — the original behavior.
  const { dataServerUrl, studyName } = getSettings();
  if (dataServerUrl && studyName) {
    params.set('data_server_url', dataServerUrl);
    params.set('study_name', studyName);
    params.set('agent_id', DEFAULT_AGENT_ID);
    // Reuse the signed-in Behaverse account key (shown on the Account settings
    // page) as the data-server bearer token. 'guest' means signed-out — no key.
    //
    // The token rides in the localStorage handoff, NOT the URL: query strings
    // leak into browser history, the address bar, the Referer header, and any
    // server access log, so a secret there is effectively exposed. localStorage
    // is same-origin-only (the runner is served from this same origin) and the
    // runner deletes the entry the moment it reads it. This adds no exposure
    // beyond what already exists — the key is the account key, which is already
    // stored in this origin's localStorage.
    const apiKey = getStoredApiKey();
    if (apiKey && apiKey !== 'guest') handoff.dataServerApiKey = apiKey;
  }

  // Hand the diagram (and, when online, the token) to the runner via
  // localStorage; Blob URLs don't survive `noopener` popups, and this keeps the
  // secret out of the URL.
  localStorage.setItem(diagramId, JSON.stringify(handoff));
  window.open(`./run.html?${params.toString()}`, '_blank', 'noopener');
}
