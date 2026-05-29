import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { loadAllSchemas } from '@/lib/core/schemas';
import { Studyflow } from './studyflow';
import { Session } from './session';
import type { Job } from '@/runner/types';
import {
  fetchManifest,
  BEHAVERSE_RUNTIME_URL,
  requiresBehaverseRuntime,
  validate,
} from './nodes';
import { NodeRenderer, type NodeOutcome } from './nodes/NodeRenderer';
import { layout, logColor, type LogKind } from './styles';
import {
  createSession,
  readDataServerConfig,
  updateSession,
  type DataServerConfig,
  type SessionHandle,
} from './dataServer';
import { createEventRecorder, type EventRecorder } from './nodes/behaverse/events';

type Log = { kind: LogKind; message: string };

/** SHA-256 hex digest of a string. Used to fingerprint the studyflow XML so
 *  downstream telemetry can pin every event to the exact source document. */
async function sha256Hex(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Parse the `diagram_id` localStorage payload the modeler hands off. It's a
 *  JSON envelope `{ xml, dataServerApiKey? }` — the API key travels here, not in
 *  the URL, so it never lands in history/referrer/logs. Tolerates a bare XML
 *  string too, so any older/external writer of this key still works. */
function parseRunnerHandoff(raw: string): { xml: string; dataServerApiKey?: string } {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.xml === 'string') {
      return {
        xml: parsed.xml,
        dataServerApiKey:
          typeof parsed.dataServerApiKey === 'string' ? parsed.dataServerApiKey : undefined,
      };
    }
  } catch {
    /* not JSON — fall through to treat the value as raw studyflow XML */
  }
  return { xml: raw };
}

/** PATCHes the data-server session with the final variable bag. No-op when
 *  the session is offline or the runner was started without a server. */
async function pushFinalState(
  config: DataServerConfig,
  handle: SessionHandle | null,
  session: Session,
  status: 'completed' | 'canceled',
  addLog: (kind: LogKind, message: string) => void,
): Promise<void> {
  if (!handle) return;
  const variables = session.getVariables();
  const completionCode = typeof variables['end.completionCode'] === 'string'
    ? (variables['end.completionCode'] as string)
    : undefined;
  const ok = await updateSession(config, handle, { status, variables, completionCode });
  if (handle.online) {
    addLog(ok ? 'info' : 'skip',
      ok
        ? `Session ${handle.sessionId} marked ${status}.`
        : `Failed to persist final state for session ${handle.sessionId}.`);
  }
}

export function Runner() {
  const params = new URLSearchParams(window.location.search);
  const studyflowUrl = params.get('studyflow_url') ?? '';
  const diagramId = params.get('diagram_id') ?? '';
  const agentId = params.get('agent_id') ?? undefined;
  const seed = params.has('seed') ? Number(params.get('seed')) : undefined;
  const dataServerConfig = readDataServerConfig(params);

  const [xml, setXml] = useState<string | null>(null);
  const [phase, setPhase] = useState('idle');
  const [log, setLog] = useState<Log[]>([]);
  const [currentJob, setCurrentJob] = useState<Job | null>(null);
  const [studyflowName, setStudyflowName] = useState<string | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const ranOnce = useRef(false);
  const resolverRef = useRef<((outcome: NodeOutcome) => void) | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const serverSessionRef = useRef<SessionHandle | null>(null);
  const dataServerRef = useRef<DataServerConfig>(dataServerConfig);
  const recorderRef = useRef<EventRecorder | null>(null);

  const addLog = useCallback((kind: LogKind, message: string) => {
    // flushSync so per-trial LLM logs paint into the sidebar BEFORE the synchronous
    // unity.SendMessage that immediately follows in bridge.ts - otherwise Unity's
    // iframe repaints first and the log appears to lag behind the visible action.
    flushSync(() => setLog((prev) => [...prev, { kind, message }]));
  }, []);

  const setVariable = useCallback((name: string, value: unknown) => {
    sessionRef.current?.setVariable(name, value);
  }, []);

  const handleResolve = useCallback((outcome: NodeOutcome) => {
    const resolver = resolverRef.current;
    if (resolver) {
      resolverRef.current = null;
      resolver(outcome);
    }
  }, []);

  useEffect(() => {
    if (diagramId) {
      const stored = localStorage.getItem(diagramId);
      if (stored) {
        localStorage.removeItem(diagramId);
        const handoff = parseRunnerHandoff(stored);
        // The modeler passes the data-server token through this same-origin
        // handoff instead of the URL (which would leak it into history/logs).
        // Non-secret config still arrives via URL params; merge the token in.
        if (handoff.dataServerApiKey) {
          dataServerRef.current = { ...dataServerRef.current, apiKey: handoff.dataServerApiKey };
        }
        setXml(handoff.xml);
      } else {
        addLog('error', `No studyflow found for diagram_id=${diagramId}.`);
        setPhase('error');
      }
      return;
    }
    if (!studyflowUrl) return;
    fetch(studyflowUrl).then((r) => r.text()).then(setXml).catch((err) => {
      addLog('error', `Failed to fetch ${studyflowUrl}: ${err}`);
      setPhase('error');
    });
  }, [diagramId, studyflowUrl]);

  useEffect(() => {
    if (!xml || ranOnce.current) return;
    ranOnce.current = true;

    (async () => {
      const dataServer = dataServerRef.current;
      try {
        setPhase('loading');
        const schemas = await loadAllSchemas();
        const studyflowHash = await sha256Hex(xml);
        const studyflow = await Studyflow.parse(xml, schemas, studyflowHash);
        const session = new Session(studyflow, { seed, agentId });
        sessionRef.current = session;
        setStudyflowName(studyflow.businessObject?.name || studyflow.businessObject?.id || null);
        addLog('info', `Parsed ${studyflow.flowNodes.size} flow nodes, ${studyflow.sequenceFlows.size} sequence flows.`);

        // The data-server study name is the studyflow's BPMN process id
        // (`studyflow.studyId`), preferred over the `study_name` URL param. This
        // scopes the session and its telemetry events to the same study, and
        // matches the `studyId` Unity stamps into each event's `context.study`.
        if (studyflow.studyId) {
          dataServer.studyName = studyflow.studyId;
        }

        const needsBehaverse = requiresBehaverseRuntime(studyflow);
        const manifest = needsBehaverse ? await fetchManifest(BEHAVERSE_RUNTIME_URL) : undefined;
        if (!needsBehaverse) addLog('info', 'No behaverse tasks - skipping Unity manifest.');

        const issues = validate(studyflow, manifest);
        if (issues.length > 0) {
          for (const issue of issues) addLog('error', `${issue.nodeId}: ${issue.message}`);
          setPhase('invalid');
          return;
        }

        const handle = await createSession(dataServer, { agentId });
        serverSessionRef.current = handle;
        session.sessionId = handle.sessionId;
        addLog(
          handle.online ? 'info' : 'skip',
          handle.online
            ? `Online (session_id=${handle.sessionId}). Data will be submitted to the data-server.`
            : `Offline (session_id=${handle.sessionId}). No data will stored or submitted.`
        );

        // Record telemetry events Unity streams over the WebGL bridge and
        // forward them to the data-server. Only when online — offline runs have
        // nowhere to send them.
        if (handle.online) {
          recorderRef.current = createEventRecorder({
            config: dataServer,
            getAgentId: () => sessionRef.current?.agentId,
            onFlush: (count, ok) =>
              addLog(
                ok ? 'info' : 'skip',
                ok ? `Recorded ${count} event(s).` : `Failed to record ${count} event(s).`,
              ),
          });
        }

        setPhase('running');
        for await (const job of session.traverse()) {
          setCurrentJob(job);
          setPhase(`job:${job.type}`);
          const outcome = await new Promise<NodeOutcome>((resolve) => {
            resolverRef.current = resolve;
          });
          resolverRef.current = null;
          if (outcome.kind === 'abort') {
            addLog('error', `Aborted at ${job.node.id}: ${outcome.reason}`);
            setPhase('aborted');
            await pushFinalState(dataServer, serverSessionRef.current, session, 'canceled', addLog);
            return;
          }
        }
        setPhase('done');
        await pushFinalState(dataServer, serverSessionRef.current, session, 'completed', addLog);
      } catch (err) {
        addLog('error', err instanceof Error ? err.message : String(err));
        setPhase('error');
        if (sessionRef.current) {
          await pushFinalState(dataServer, serverSessionRef.current, sessionRef.current, 'canceled', addLog);
        }
      } finally {
        // Drain any buffered telemetry and detach the listener, however the run
        // ended (done / aborted / errored / early return).
        await recorderRef.current?.flush();
        recorderRef.current?.stop();
        recorderRef.current = null;
      }
    })();
  }, [xml, seed]);

  if (!xml) return <Help onFileLoaded={setXml} />;

  return (
    <div className={layout.page}>
      <main className={layout.body}>
        <div className={layout.stage}>
          {currentJob ? (
            <NodeRenderer
              key={currentJob.node.id}
              job={currentJob}
              session={sessionRef.current!}
              log={addLog}
              setVariable={setVariable}
              onResolve={handleResolve}
            />
          ) : (
            <div className={`${layout.cover} ${layout.coverShown}`}>
              <span>Preparing study... ({phase})</span>
            </div>
          )}
          {/* Floating logs toggle — overlays the stage so it's visible above
              any iframe content. The sidebar (z-10) covers it when open; the
              sidebar's own × handles closing from that state. */}
          <button
            type="button"
            onClick={() => setLogsOpen((v) => !v)}
            className={layout.logsToggle}
            aria-expanded={logsOpen}
          >
            {logsOpen ? 'Hide logs' : `Logs${log.length ? ` (${log.length})` : ''}`}
          </button>
        </div>
        <aside
          className={`${layout.sidebar} ${logsOpen ? layout.sidebarOpen : layout.sidebarClosed}`}
          aria-hidden={!logsOpen}
        >
          <div className={layout.sidebarHeader}>
            <div className={layout.sidebarInfo}>
              <span className={layout.title}>{studyflowName ?? 'Studyflow'}</span>
              <div className={layout.sidebarInfoMetaRow}>
                <span className={layout.badge}>{phase}</span>
                {seed != null && <span className={layout.meta}>seed={seed}</span>}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setLogsOpen(false)}
              className={layout.sidebarClose}
              aria-label="Close logs"
            >
              ×
            </button>
          </div>
          <ol className={layout.sidebarList}>
            {log.map((entry, i) => (
              <li key={i} className={logColor[entry.kind]}>{entry.message}</li>
            ))}
          </ol>
        </aside>
      </main>
    </div>
  );
}

function Help({ onFileLoaded }: { onFileLoaded: (xml: string) => void }) {
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then(onFileLoaded);
  };

  return (
    <div className={layout.helpPage}>
      <h1 className={layout.helpTitle}>Studyflow</h1>
      <p className={layout.helpText}>
        Upload a <code>.studyflow</code> file, or pass a <code>studyflow_url</code> query parameter.
        Add <code>data_server_url</code> to persist sessions, variables, and telemetry events; the
        study name comes from the studyflow's process <code>id</code> (<code>study_name</code> is an
        optional fallback). Omit <code>data_server_url</code> (or pass <code>disable_data_server=1</code>)
        to run offline.
      </p>
      <label className={layout.uploadButton}>
        <input
          type="file"
          accept=".studyflow,.bpmn,.xml"
          onChange={onChange}
          className={layout.uploadInput}
        />
        <span>Choose file...</span>
      </label>
      <pre className={layout.helpExample}>
        run.html?studyflow_url=https://data.behaverse.org/v1/studies/pilot3/studyflow&data_server_url=https://data.behaverse.org/v1&study_name=pilot3&agent_id=p001&seed=42
      </pre>
    </div>
  );
}
