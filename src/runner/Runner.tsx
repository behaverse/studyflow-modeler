import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { loadAllSchemas } from '@/lib/core/schemas';
import { Study } from './study';
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

/** PATCHes the data-server session with the final variable bag. No-op when
 *  the session is offline or the runner was started without a server. */
async function pushFinalState(
  config: DataServerConfig,
  handle: SessionHandle | null,
  study: Study,
  status: 'completed' | 'canceled',
  addLog: (kind: LogKind, message: string) => void,
): Promise<void> {
  if (!handle) return;
  const variables = study.getVariables();
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
  const sessionId = params.get('session_id') ?? '';
  const agentId = params.get('agent_id') ?? undefined;
  const seed = params.has('seed') ? Number(params.get('seed')) : undefined;
  const dataServerConfig = readDataServerConfig(params);

  const [xml, setXml] = useState<string | null>(null);
  const [phase, setPhase] = useState('idle');
  const [log, setLog] = useState<Log[]>([]);
  const [currentJob, setCurrentJob] = useState<Job | null>(null);
  const [studyName, setStudyName] = useState<string | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const ranOnce = useRef(false);
  const resolverRef = useRef<((outcome: NodeOutcome) => void) | null>(null);
  const studyRef = useRef<Study | null>(null);
  const sessionRef = useRef<SessionHandle | null>(null);
  const dataServerRef = useRef<DataServerConfig>(dataServerConfig);

  const addLog = useCallback((kind: LogKind, message: string) => {
    // flushSync so per-trial LLM logs paint into the sidebar BEFORE the synchronous
    // unity.SendMessage that immediately follows in bridge.ts — otherwise Unity's
    // iframe repaints first and the log appears to lag behind the visible action.
    flushSync(() => setLog((prev) => [...prev, { kind, message }]));
  }, []);

  const setVariable = useCallback((name: string, value: unknown) => {
    studyRef.current?.setVariable(name, value);
  }, []);

  const handleResolve = useCallback((outcome: NodeOutcome) => {
    const resolver = resolverRef.current;
    if (resolver) {
      resolverRef.current = null;
      resolver(outcome);
    }
  }, []);

  useEffect(() => {
    if (sessionId) {
      const stored = localStorage.getItem(sessionId);
      if (stored) {
        localStorage.removeItem(sessionId);
        setXml(stored);
      } else {
        addLog('error', `No studyflow found for session=${sessionId}.`);
        setPhase('error');
      }
      return;
    }
    if (!studyflowUrl) return;
    fetch(studyflowUrl).then((r) => r.text()).then(setXml).catch((err) => {
      addLog('error', `Failed to fetch ${studyflowUrl}: ${err}`);
      setPhase('error');
    });
  }, [sessionId, studyflowUrl]);

  useEffect(() => {
    if (!xml || ranOnce.current) return;
    ranOnce.current = true;

    (async () => {
      const dataServer = dataServerRef.current;
      try {
        setPhase('loading');
        const schemas = await loadAllSchemas();
        const studyflowHash = await sha256Hex(xml);
        const study = await Study.parse(xml, schemas, {
          seed,
          agentId,
          sessionId: sessionId || undefined,
          studyflowHash,
        });
        studyRef.current = study;
        setStudyName(study.businessObject?.name || study.businessObject?.id || null);
        addLog('info', `Parsed ${study.flowNodes.size} flow nodes, ${study.sequenceFlows.size} sequence flows.`);

        const needsBehaverse = requiresBehaverseRuntime(study);
        const manifest = needsBehaverse ? await fetchManifest(BEHAVERSE_RUNTIME_URL) : undefined;
        if (!needsBehaverse) addLog('info', 'No behaverse tasks - skipping Unity manifest.');

        const issues = validate(study, manifest);
        if (issues.length > 0) {
          for (const issue of issues) addLog('error', `${issue.nodeId}: ${issue.message}`);
          setPhase('invalid');
          return;
        }

        const session = await createSession(dataServer, { agentId });
        sessionRef.current = session;
        study.sessionId = session.sessionId;
        addLog(
          session.online ? 'info' : 'skip',
          session.online
            ? `Session ${session.sessionId} registered with data-server.`
            : `Running offline (session=${session.sessionId}); data-server writes are skipped.`,
        );

        setPhase('running');
        for await (const job of study.traverse()) {
          setCurrentJob(job);
          setPhase(`job:${job.type}`);
          const outcome = await new Promise<NodeOutcome>((resolve) => {
            resolverRef.current = resolve;
          });
          resolverRef.current = null;
          if (outcome.kind === 'abort') {
            addLog('error', `Aborted at ${job.node.id}: ${outcome.reason}`);
            setPhase('aborted');
            await pushFinalState(dataServer, sessionRef.current, study, 'canceled', addLog);
            return;
          }
        }
        setPhase('done');
        await pushFinalState(dataServer, sessionRef.current, study, 'completed', addLog);
      } catch (err) {
        addLog('error', err instanceof Error ? err.message : String(err));
        setPhase('error');
        if (studyRef.current) {
          await pushFinalState(dataServer, sessionRef.current, studyRef.current, 'canceled', addLog);
        }
      }
    })();
  }, [xml, seed]);

  if (!xml) return <Help onFileLoaded={setXml} />;

  return (
    <div className={layout.page}>
      <header className={layout.header}>
        <span className={layout.title}>{studyName ?? 'Studyflow'}</span>
        <span className={layout.badge}>{phase}</span>
        {seed != null && <span className={layout.meta}>seed={seed}</span>}
        <button
          type="button"
          onClick={() => setLogsOpen((v) => !v)}
          className={layout.logsToggle}
          aria-expanded={logsOpen}
        >
          {logsOpen ? 'Hide logs' : `Logs${log.length ? ` (${log.length})` : ''}`}
        </button>
      </header>
      <main className={layout.body}>
        <div className={layout.stage}>
          {currentJob ? (
            <NodeRenderer
              key={currentJob.node.id}
              job={currentJob}
              study={studyRef.current!}
              log={addLog}
              setVariable={setVariable}
              onResolve={handleResolve}
            />
          ) : (
            <div className={`${layout.cover} ${layout.coverShown}`}>
              <span>Preparing study... ({phase})</span>
            </div>
          )}
        </div>
        <aside
          className={`${layout.sidebar} ${logsOpen ? layout.sidebarOpen : layout.sidebarClosed}`}
          aria-hidden={!logsOpen}
        >
          <div className={layout.sidebarHeader}>
            <h2 className={layout.sidebarTitle}>Logs</h2>
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
        Add <code>data_server_url</code> + <code>study_name</code> to persist sessions and variables;
        omit them (or pass <code>disable_data_server=1</code>) to run offline.
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
