import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { loadAllSchemas } from '@/core/notation/loader';
import { shouldRecordEvents, setRecordEvents } from '@/core/settings';
import { clearDiagramHandoff, readDiagramHandoff } from '@/core/storage';
import { Studyflow } from '@/runner/studyflow';
import { Session } from '@/runner/session';
import type { Job } from '@/runner/jobs';
import { findByType, validate } from '@/runner/nodes';
import type { LogKind, NodeProps, ValidationIssue } from '@/runner/nodes/types';
import {
  createSession,
  finishSession,
  loadDataServerConfig,
  type DataServerConfig,
  type SessionHandle,
} from '@/runner/dataServer';
import { createEventRecorder, type EventRecorder } from '@/runner/nodes/behaverse/events';

export const layout = {
  page: 'flex flex-col h-screen',
  title: 'font-semibold text-stone-900 text-sm leading-tight',
  badge: 'text-[10px] uppercase bg-stone-200 text-stone-700 rounded px-2 py-0.5',
  meta: 'text-[10px] uppercase tracking-wide text-stone-500',
  body: 'relative flex flex-1 min-h-0',
  stage: 'relative flex-1 bg-black',
  cover: 'absolute inset-0 flex items-center justify-center bg-black/85 text-white text-sm transition-opacity duration-300',
  coverShown: 'opacity-100',
  terminal: 'absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/90 p-8 text-white overflow-y-auto',
  terminalTitle: 'text-lg font-semibold',
  terminalBody: 'max-w-prose text-sm text-white/70 text-center',
  terminalList: 'max-w-prose w-full text-xs text-white/60 space-y-1 font-mono',
  logsToggle: 'absolute top-3 right-3 z-20 text-[11px] uppercase tracking-wide bg-black/70 hover:bg-black/85 text-white rounded px-2.5 py-1 backdrop-blur transition-colors shadow-md',
  sidebar: 'absolute top-0 right-0 bottom-0 w-80 bg-stone-100 border-l border-stone-300 flex flex-col p-3 text-sm shadow-lg transition-transform duration-200 z-10',
  sidebarOpen: 'translate-x-0',
  sidebarClosed: 'translate-x-full',
  sidebarHeader: 'flex items-start justify-between gap-2 mb-3 pb-2 border-b border-stone-300',
  sidebarInfo: 'flex flex-col gap-1 min-w-0',
  sidebarInfoMetaRow: 'flex items-center gap-2 flex-wrap',
  sidebarClose: 'text-stone-500 hover:text-stone-800 text-lg leading-none shrink-0',
  recordToggle: 'flex items-center gap-2 mb-3 text-xs text-stone-600 select-none cursor-pointer',
  sidebarList: 'space-y-1 flex-1 min-h-0 overflow-y-auto',
  helpPage: 'p-6 max-w-xl mx-auto',
  helpTitle: 'text-2xl font-semibold mb-3',
  helpText: 'mb-4 text-stone-700',
  helpExample: 'bg-stone-100 p-3 text-xs mt-4',
  uploadButton: 'inline-flex items-center gap-2 cursor-pointer bg-fuchsia-800 hover:bg-fuchsia-900 text-white text-sm font-medium px-4 py-2 rounded transition-colors',
  uploadInput: 'sr-only',
} as const;

export const logColor: Record<LogKind, string> = {
  info: 'text-stone-700',
  task: 'text-blue-700',
  ok: 'text-emerald-700',
  error: 'text-red-700',
  skip: 'text-amber-700',
};

type NodeOutcome =
  | { kind: 'complete' }
  | { kind: 'abort'; reason: string };

type NodeRendererProps = {
  job: Job;
  session: Session;
  log: (kind: LogKind, message: string) => void;
  onResolve: (outcome: NodeOutcome) => void;
};

function NodeRenderer({ job, session, log, onResolve }: NodeRendererProps) {
  const resolvedRef = useRef(false);

  const resolveOnce = useCallback((outcome: NodeOutcome) => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    onResolve(outcome);
  }, [onResolve]);

  const complete = useCallback(() => resolveOnce({ kind: 'complete' }), [resolveOnce]);
  const abort = useCallback((reason: string) => resolveOnce({ kind: 'abort', reason }), [resolveOnce]);

  const def = findByType(job.type);

  useEffect(() => {
    if (!def) resolveOnce({ kind: 'abort', reason: `unknown-job-type:${job.type}` });
  }, [def, job.type, resolveOnce]);

  if (!def) return null;

  const Component = def.Component;
  return <Component {...({ job, session, log, complete, abort } as NodeProps<any>)} />;
}

type Log = { kind: LogKind; message: string };

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
  const [blockingIssues, setBlockingIssues] = useState<ValidationIssue[]>([]);
  const [runError, setRunError] = useState<string | undefined>();
  const [logsOpen, setLogsOpen] = useState(false);
  const [recording, setRecording] = useState(shouldRecordEvents());
  const ranOnce = useRef(false);
  const resolverRef = useRef<((outcome: NodeOutcome) => void) | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const serverSessionRef = useRef<SessionHandle | null>(null);
  const dataServerRef = useRef<DataServerConfig>(dataServerConfig);
  const recorderRef = useRef<EventRecorder | null>(null);
  const logListRef = useRef<HTMLOListElement>(null);
  const stickToBottom = useRef(true);

  const addLog = useCallback((kind: LogKind, message: string) => {
    // flushSync so per-trial LLM logs paint before the synchronous unity.SendMessage in unityRuntime.ts.
    flushSync(() => setLog((prev) => [...prev, { kind, message }]));
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
    dataServerRef.current.disabled = !next;
  }, []);

  const onLogScroll = useCallback((e: React.UIEvent<HTMLOListElement>) => {
    const el = e.currentTarget;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  useEffect(() => {
    const el = logListRef.current;
    if (logsOpen && el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [log, logsOpen]);

  /* eslint-disable react-hooks/set-state-in-effect -- one-shot boot: the source
     is a URL param, so the first render has nothing to derive this from. */
  useEffect(() => {
    if (diagramId) {
      const stored = readDiagramHandoff(diagramId);
      if (stored) {
        setXml(stored);
      } else {
        addLog('error', `No studyflow found for diagram_id=${diagramId}.`);
        setRunError(
          'The link has expired or was already used. Ask for a new link, or open the '
          + 'diagram in the modeler and press Run again.',
        );
        setPhase('error');
      }
      return;
    }
    if (!studyflowUrl) return;
    fetch(studyflowUrl).then((r) => r.text()).then(setXml).catch((err) => {
      addLog('error', `Failed to fetch ${studyflowUrl}: ${err}`);
      setRunError(`The studyflow at ${studyflowUrl} could not be loaded.`);
      setPhase('error');
    });
  }, [diagramId, studyflowUrl]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!xml || ranOnce.current) return;
    ranOnce.current = true;

    (async () => {
      const dataServer = dataServerRef.current;
      try {
        setPhase('loading');
        const schemas = await loadAllSchemas();
        const studyflow = await Studyflow.parse(xml, schemas);
        const agentId = `anon-${crypto.randomUUID().slice(0, 8)}`;
        const session = new Session(studyflow, {
          seed,
          agentId,
          onDiagnostic: (message: string) => addLog('error', message),
        });
        sessionRef.current = session;
        setSession(session);
        setStudyflowName(studyflow.businessObject?.name || studyflow.businessObject?.id || null);
        addLog('info', `Parsed ${studyflow.flowNodes.size} flow nodes, ${studyflow.sequenceFlows.size} sequence flows.`);

        if (studyflow.studyId) {
          dataServer.studyName = studyflow.studyId;
        }

        const issues = await validate(studyflow, addLog);
        for (const issue of issues) {
          addLog(issue.severity === 'warning' ? 'skip' : 'error', `${issue.nodeId}: ${issue.message}`);
        }
        const blocking = issues.filter((issue) => issue.severity !== 'warning');
        if (blocking.length > 0) {
          setBlockingIssues(blocking);
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
            await finishSession(dataServer, serverSessionRef.current, session, 'canceled', addLog);
            return;
          }
        }
        setPhase('done');
        await finishSession(dataServer, serverSessionRef.current, session, 'completed', addLog);
      } catch (err) {
        addLog('error', err instanceof Error ? err.message : String(err));
        setRunError(err instanceof Error ? err.message : String(err));
        setPhase('error');
        if (sessionRef.current) {
          await finishSession(dataServer, serverSessionRef.current, sessionRef.current, 'canceled', addLog);
        }
      } finally {
        await recorderRef.current?.flush();
        recorderRef.current?.stop();
        recorderRef.current = null;
        if (diagramId) clearDiagramHandoff(diagramId);
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
              session={session!}
              log={addLog}
              onResolve={handleResolve}
            />
          ) : phase === 'invalid' ? (
            <div className={layout.terminal} role="alert" data-testid="runner-invalid">
              <p className={layout.terminalTitle}>This study cannot run</p>
              <p className={layout.terminalBody}>
                The diagram has {blockingIssues.length === 1 ? 'a problem' : 'problems'} that
                must be fixed before it can be delivered to a participant.
              </p>
              <ul className={layout.terminalList}>
                {blockingIssues.map((issue, i) => (
                  <li key={`${issue.nodeId}:${i}`}>{issue.nodeId}: {issue.message}</li>
                ))}
              </ul>
            </div>
          ) : phase === 'error' ? (
            <div className={layout.terminal} role="alert" data-testid="runner-error">
              <p className={layout.terminalTitle}>The study could not start</p>
              <p className={layout.terminalBody}>{runError ?? 'An unexpected error occurred.'}</p>
            </div>
          ) : (
            <div className={`${layout.cover} ${layout.coverShown}`}>
              <span>Preparing study... ({phase})</span>
            </div>
          )}
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
