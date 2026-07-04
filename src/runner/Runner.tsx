import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { loadAllSchemas } from '@/lib/core/schema/loader';
import { shouldRecordEvents, setRecordEvents } from '@/lib/core/runnerSettings';
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
  loadDataServerConfig,
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
  const seed = params.has('seed') ? Number(params.get('seed')) : undefined;
  const dataServerConfig = loadDataServerConfig();

  const [xml, setXml] = useState<string | null>(null);
  const [phase, setPhase] = useState('idle');
  const [log, setLog] = useState<Log[]>([]);
  const [currentJob, setCurrentJob] = useState<Job | null>(null);
  const [studyflowName, setStudyflowName] = useState<string | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  // Whether this run records its data (session, variables, Unity events) to the
  // data-server. Off by default; the runner — not the modeler — owns this
  // decision. Stored so it sticks across runs.
  const [recording, setRecording] = useState(shouldRecordEvents());
  const ranOnce = useRef(false);
  const resolverRef = useRef<((outcome: NodeOutcome) => void) | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const serverSessionRef = useRef<SessionHandle | null>(null);
  const dataServerRef = useRef<DataServerConfig>(dataServerConfig);
  const recorderRef = useRef<EventRecorder | null>(null);
  const logListRef = useRef<HTMLOListElement>(null);
  const stickToBottom = useRef(true);

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

  const toggleRecordEvents = useCallback((next: boolean) => {
    setRecording(next);
    setRecordEvents(next);
    // Mutate in place (don't replace)
    dataServerRef.current.disabled = !next;
  }, []);

  // Remember whether the log list is pinned to (near) the bottom, so streaming
  // entries auto-follow only when the user hasn't scrolled up to read history.
  const onLogScroll = useCallback((e: React.UIEvent<HTMLOListElement>) => {
    const el = e.currentTarget;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  // Keep the newest log line in view as entries stream in (e.g. per-trial LLM
  // calls), so the panel reflects activity in real time.
  useEffect(() => {
    const el = logListRef.current;
    if (logsOpen && el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [log, logsOpen]);

  useEffect(() => {
    if (diagramId) {
      const stored = localStorage.getItem(diagramId);
      if (stored) {
        localStorage.removeItem(diagramId);
        setXml(stored);
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
        // Modeler and standalone runs aren't tied to a real participant, so mint
        // a throwaway agent id; it groups the session and its telemetry events
        // under one identity for this run.
        const agentId = `anon-${crypto.randomUUID().slice(0, 8)}`;
        const session = new Session(studyflow, { seed, agentId });
        sessionRef.current = session;
        setStudyflowName(studyflow.businessObject?.name || studyflow.businessObject?.id || null);
        addLog('info', `Parsed ${studyflow.flowNodes.size} flow nodes, ${studyflow.sequenceFlows.size} sequence flows.`);

        // The data-server study name is the studyflow's BPMN process id
        // (`studyflow.studyId`) — the only source, since it's intrinsic to the
        // diagram. It scopes the session and its telemetry events to the same
        // study, and matches the `studyId` Unity stamps into each event's
        // `context.study`. Without it there's no study to address, so stay offline.
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
          <label className={layout.recordToggle}>
            <input
              type="checkbox"
              checked={recording}
              onChange={(e) => toggleRecordEvents(e.target.checked)}
              className="accent-fuchsia-800"
            />
            <span>Record events</span>
          </label>
          <ol ref={logListRef} onScroll={onLogScroll} className={layout.sidebarList}>
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
        Runs record sessions, variables, and telemetry events to the Behaverse data-server when
        you enable “Record events” in the logs panel (off by default). The study name comes from
        the studyflow's process <code>id</code>, and an agent id is generated automatically.
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
        run.html?studyflow_url=https://data.behaverse.org/v1/studies/pilot3/studyflow&seed=42
      </pre>
    </div>
  );
}
