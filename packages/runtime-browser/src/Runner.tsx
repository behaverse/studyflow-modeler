import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadAllSchemas } from '@core/notation/loader';
import { clearDiagramHandoff, readDiagramHandoff } from '@core/storage';
import { readParameters, resolveRunSource } from '@runner/source';
import { describeForDebug, isDebug } from '@runner/debug';
import { DebugPanel } from '@runner/nodes/DebugPanel';
import { readParticipant, readSubjectId } from '@runner/subject';
import { Studyflow } from '@runner/studyflow';
import { Aborted, Session } from '@runner/session';
import type { Job } from '@runner/jobs';
import { findByType, skillModulesLoaded, validate } from '@runner/nodes';
import type { LogKind, NodeProps, ValidationIssue } from '@runner/nodes/types';
import { getRunObservers, type RunObserver } from '@runner/observers';

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
  recordLink: 'mb-3 text-xs text-fuchsia-800 underline self-start',
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
    if (!def) resolveOnce({ kind: 'abort', reason: `the browser runner has no screen for '${job.type}' steps` });
  }, [def, job.type, resolveOnce]);

  if (!def) return null;

  // One interception rather than a branch inside every heavy node.
  if (def.heavy && isDebug()) {
    return <DebugPanel card={describeForDebug(job.node, def.type)} onContinue={complete} />;
  }

  const Component = def.Component;
  return <Component {...({ job, session, log, complete, abort } as NodeProps<any>)} />;
}

type Log = { kind: LogKind; message: string };

const demoFiles = import.meta.glob(
  '#assets/demos/*.studyflow',
  { query: '?url', import: 'default', eager: true },
) as Record<string, string>;

/** `diagram=<name>` runs the shipped `<name>.studyflow`, parameterized by the rest of the query string. */
const DEMOS: Record<string, string> = Object.fromEntries(
  Object.entries(demoFiles).map(([path, url]) => [
    path.split('/').pop()!.replace(/\.studyflow$/, ''),
    url,
  ]),
);

export function Runner() {
  // The query string is fixed for the page's life: read it once, so the effects below have stable inputs.
  const { source, handoffId, parameters } = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const found = resolveRunSource(params.get('diagram') ?? '', DEMOS);
    return { source: found, handoffId: found?.kind === 'handoff' ? found.id : '', parameters: readParameters(params) };
  }, []);

  const [seed, setSeed] = useState<number | undefined>();
  const [xml, setXml] = useState<string | null>(null);
  const [phase, setPhase] = useState('idle');
  const [log, setLog] = useState<Log[]>([]);
  const [currentJob, setCurrentJob] = useState<Job | null>(null);
  // Each screen shown is a new one, a step reached again included, so it starts afresh and takes its own click.
  const [shown, setShown] = useState(0);
  const [studyflowName, setStudyflowName] = useState<string | null>(null);
  const [blockingIssues, setBlockingIssues] = useState<ValidationIssue[]>([]);
  const [runError, setRunError] = useState<string | undefined>();
  const [logsOpen, setLogsOpen] = useState(false);
  const [toggles, setToggles] = useState<NonNullable<RunObserver['toggle']>[]>([]);
  const ranOnce = useRef(false);
  const resolverRef = useRef<((outcome: NodeOutcome) => void) | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  // The skills watching this run, once it starts.
  const observersRef = useRef<RunObserver[]>([]);
  const logListRef = useRef<HTMLOListElement>(null);
  const stickToBottom = useRef(true);

  // A plain update: nodes log from their effects, where React refuses flushSync. A caller that needs its
  // line on the page at once flushes it itself (the Behaverse node, before unity.SendMessage).
  const addLog = useCallback((kind: LogKind, message: string) => {
    setLog((prev) => [...prev, { kind, message }]);
  }, []);

  const handleResolve = useCallback((outcome: NodeOutcome) => {
    const resolver = resolverRef.current;
    if (resolver) {
      resolverRef.current = null;
      resolver(outcome);
    }
  }, []);

  // The switches the skills watching a run offer, once their modules have registered.
  useEffect(() => {
    void skillModulesLoaded.then(() => setToggles(getRunObservers().flatMap((observer) => observer.toggle ?? [])));
  }, []);

  const onLogScroll = useCallback((e: React.UIEvent<HTMLOListElement>) => {
    const el = e.currentTarget;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  useEffect(() => {
    const el = logListRef.current;
    if (logsOpen && el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [log, logsOpen]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!source) return;
    if (source.kind === 'handoff') {
      const stored = readDiagramHandoff(source.id);
      if (stored) {
        setXml(stored);
      } else {
        addLog('error', `No studyflow was handed over for diagram=${source.id}.`);
        setRunError(
          'This link has expired or was already used. Ask for a new one, or open the '
          + 'studyflow in the modeler and press Run again.',
        );
        setPhase('error');
      }
      return;
    }
    fetch(source.url).then((r) => r.text()).then(setXml).catch((err) => {
      addLog('error', `Could not fetch ${source.url}: ${err}`);
      setRunError(
        `The studyflow at ${source.url} could not be loaded. `
        + 'Check that the address is right and reachable from this browser.',
      );
      setPhase('error');
    });
  }, [source, addLog]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!xml || ranOnce.current) return;
    ranOnce.current = true;

    (async () => {
      const finish = async (session: Session, status: 'completed' | 'canceled') => {
        for (const observer of observersRef.current) await observer.finish({ session, status, log: addLog });
      };
      try {
        setPhase('loading');
        const schemas = await loadAllSchemas();
        const studyflow = await Studyflow.parse(xml, schemas, parameters);
        // The session picks each step's screen as it starts, so the skills' screens must have registered by then.
        await skillModulesLoaded;
        const { values, overridden, undeclared, unbound } = studyflow.parameters;
        // A subject id names the run in the record.
        const agentId = readSubjectId(parameters) ?? `anon-${crypto.randomUUID().slice(0, 8)}`;
        const participant = readParticipant(parameters);
        const session = new Session(studyflow, {
          seed: studyflow.seed,
          participant,
          agentId,
          variables: values,
          onDiagnostic: (message: string) => addLog('error', message),
          // A screen whose time is up is dropped: the loop below goes on to the next job.
          onExpired: () => handleResolve({ kind: 'complete' }),
        });
        if (participant === undefined && session.draws) {
          addLog('info', 'The link gives no ?participant=, so this session draws at each random gateway as participant 1.');
        }
        sessionRef.current = session;
        setSession(session);
        setSeed(studyflow.seed);
        setStudyflowName(studyflow.studyflowId ?? null);
        addLog('info', `Read ${studyflow.flowNodes.size} flow nodes and ${studyflow.sequenceFlows.size} sequence flows.`);

        for (const name of overridden) {
          addLog('info', `The link sets '${name}' to ${parameters[name]}, replacing the study's own value.`);
        }
        for (const name of undeclared) {
          addLog('skip', `'${name}' is not a declared parameter of this studyflow; its value is bound anyway.`);
        }

        // A value the link leaves unset is the first thing to fix, before the checks read a study missing it.
        const them = unbound.length === 1 ? 'it' : 'them';
        const issues: ValidationIssue[] = unbound.length > 0
          ? [{ message: `This studyflow expects ${unbound.join(', ')} to be set, and this link does not set ${them}. Add ${them} to the address, e.g. &${unbound[0]}=...` }]
          : await validate(studyflow, addLog);
        for (const issue of issues) {
          addLog(issue.severity === 'warning' ? 'skip' : 'error', named(issue));
        }
        const blocking = issues.filter((issue) => issue.severity !== 'warning');
        if (blocking.length > 0) {
          setBlockingIssues(blocking);
          setPhase('invalid');
          return;
        }

        // The skills watching the run start with it; the first to name the run names it.
        let runId: string | undefined;
        for (const observer of getRunObservers()) {
          const named = await observer.start({ studyId: studyflow.studyId, agentId, log: addLog });
          observersRef.current.push(observer);
          runId ??= named?.runId;
        }
        session.sessionId = runId ?? crypto.randomUUID();

        setPhase('running');
        for await (const job of session.traverse()) {
          setCurrentJob(job);
          setShown((count) => count + 1);
          setPhase(`job:${job.type}`);
          const outcome = await new Promise<NodeOutcome>((resolve) => {
            resolverRef.current = resolve;
          });
          resolverRef.current = null;
          // A step refused leaves by its error boundary event when it carries one; else the run stops there.
          if (outcome.kind === 'abort') {
            addLog('error', `'${job.node.id}' was not finished: ${outcome.reason}.`);
            session.abort(outcome.reason);
          }
        }
        setPhase('done');
        await finish(session, 'completed');
      } catch (err) {
        if (err instanceof Aborted) {
          addLog('error', `The run stopped: ${err.message}.`);
          setPhase('aborted');
          await finish(sessionRef.current!, 'canceled');
          return;
        }
        addLog('error', err instanceof Error ? err.message : String(err));
        setRunError(err instanceof Error ? err.message : String(err));
        setPhase('error');
        if (sessionRef.current) await finish(sessionRef.current, 'canceled');
      } finally {
        for (const observer of observersRef.current) await observer.close?.();
        observersRef.current = [];
        if (handoffId) clearDiagramHandoff(handoffId);
      }
    })();
  }, [xml, addLog, handleResolve, handoffId, parameters]);

  // A link that names a study it cannot load says why, below; only a link that names none asks for a file.
  if (!xml && !source) return <Help onFileLoaded={setXml} />;

  return (
    <div className={layout.page}>
      <main className={layout.body}>
        <div className={layout.stage}>
          {currentJob ? (
            <NodeRenderer
              key={shown}
              job={currentJob}
              session={session!}
              log={addLog}
              onResolve={handleResolve}
            />
          ) : phase === 'invalid' ? (
            <div className={layout.terminal} role="alert" data-testid="runner-invalid">
              <p className={layout.terminalTitle}>This study cannot run</p>
              <p className={layout.terminalBody}>
                Fix {blockingIssues.length === 1 ? 'this' : 'these'}, then run it again.
                Until then it cannot be given to a participant.
              </p>
              <ul className={layout.terminalList}>
                {blockingIssues.map((issue, i) => (
                  <li key={i}>{named(issue)}</li>
                ))}
              </ul>
            </div>
          ) : phase === 'error' ? (
            <div className={layout.terminal} role="alert" data-testid="runner-error">
              <p className={layout.terminalTitle}>The study could not start</p>
              <p className={layout.terminalBody}>
                {runError ?? 'Something went wrong before the first step. Open the logs for the details.'}
              </p>
            </div>
          ) : (
            <div className={`${layout.cover} ${layout.coverShown}`}>
              <span>Preparing the study...</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => setLogsOpen((v) => !v)}
            className={layout.logsToggle}
            aria-expanded={logsOpen}
          >
            {logsOpen ? 'Close' : `Logs${log.length ? ` (${log.length})` : ''}`}
          </button>
        </div>
        <aside
          className={`${layout.sidebar} ${logsOpen ? layout.sidebarOpen : layout.sidebarClosed}`}
          aria-hidden={!logsOpen}
        >
          <div className={layout.sidebarHeader}>
            <div className={layout.sidebarInfo}>
              <span className={layout.title}>{studyflowName ?? 'Untitled studyflow'}</span>
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
          {toggles.map((toggle) => <ObserverToggle key={toggle.label} toggle={toggle} />)}
          {session && ['done', 'aborted', 'error'].includes(phase) && (
            <button type="button" className={layout.recordLink} onClick={() => downloadRecord(session)}>
              Download the run's record (events.jsonl)
            </button>
          )}
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

/** A skill's switch beside the log, such as recording the run. */
function ObserverToggle({ toggle }: { toggle: NonNullable<RunObserver['toggle']> }) {
  const [on, setOn] = useState(toggle.get);
  return (
    <label className={layout.recordToggle}>
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => { toggle.set(e.target.checked); setOn(toggle.get()); }}
        className="accent-fuchsia-800"
      />
      <span>{toggle.label}</span>
    </label>
  );
}

/** An issue as the screen and the log say it: after the step it is about, when it is about one. */
function named(issue: ValidationIssue): string {
  return issue.nodeId ? `${issue.nodeId}: ${issue.message}` : issue.message;
}

/** The run's record, as a local run keeps it in `events.jsonl`: one event a line. */
function downloadRecord(session: Session): void {
  const text = session.getRecord().map((event) => JSON.stringify(event)).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([`${text}\n`], { type: 'application/x-ndjson' }));
  link.download = 'events.jsonl';
  link.click();
  URL.revokeObjectURL(link.href);
}

function Help({ onFileLoaded }: { onFileLoaded: (xml: string) => void }) {
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then(onFileLoaded);
  };

  return (
    <div className={layout.helpPage}>
      <h1 className={layout.helpTitle}>Run a studyflow</h1>
      <p className={layout.helpText}>
        Choose a <code>.studyflow.yaml</code> file, or open this page with a <code>diagram</code>{' '}
        parameter — a URL to fetch, or the id of a studyflow the modeler handed over. Everything
        else in the address sets a parameter of the study.
      </p>
      <label className={layout.uploadButton}>
        <input
          type="file"
          accept=".studyflow,.yaml,.yml,.bpmn,.xml"
          onChange={onChange}
          className={layout.uploadInput}
        />
        <span>Choose a file...</span>
      </label>
      <pre className={layout.helpExample}>
        run?diagram=URL&seed=42{'\n\n'}
        run?diagram=behaverse&task=BCS&timeline=XCIT_BCS_02
      </pre>
    </div>
  );
}
