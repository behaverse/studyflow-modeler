import { useCallback, useEffect, useRef, useState } from 'react';
import { executeCommand } from '@/modeler/commands';
import { parseStudyflow } from './parser';
import { Graph } from './graph';
import type { Job } from './types';
import {
  fetchManifest,
  BEHAVERSE_RUNTIME_URL,
  requiresBehaverseRuntime,
  validate,
} from './nodes';
import { NodeRenderer, type NodeOutcome } from './nodes/NodeRenderer';
import { layout, logColor, type LogKind } from './styles';

type Log = { kind: LogKind; message: string };

export function Executor() {
  const params = new URLSearchParams(window.location.search);
  const studyflowUrl = params.get('studyflow_url') ?? '';
  const sessionId = params.get('session_id') ?? '';
  const seed = params.get('seed') ? Number(params.get('seed')) : undefined;

  const [xml, setXml] = useState<string | null>(null);
  const [phase, setPhase] = useState('idle');
  const [log, setLog] = useState<Log[]>([]);
  const [currentJob, setCurrentJob] = useState<Job | null>(null);
  const [studyName, setStudyName] = useState<string | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const ranOnce = useRef(false);
  const resolverRef = useRef<((outcome: NodeOutcome) => void) | null>(null);
  const graphRef = useRef<Graph | null>(null);

  const say = (entry: Log) => setLog((prev) => [...prev, entry]);

  const sayLog = useCallback((kind: LogKind, message: string) => {
    setLog((prev) => [...prev, { kind, message }]);
  }, []);
  const setVariable = useCallback((name: string, value: unknown) => {
    graphRef.current?.setVariable(name, value);
  }, []);

  const handleResolve = useCallback((outcome: NodeOutcome) => {
    const resolver = resolverRef.current;
    if (resolver) {
      resolverRef.current = null;
      resolver(outcome);
    }
  }, []);

  // XML resolution:
  // 1. `session_id` — modeler "Run" button stashes XML in localStorage.
  // 2. `studyflow_url` — direct URL fetch.
  useEffect(() => {
    if (sessionId) {
      const stored = localStorage.getItem(sessionId);
      if (stored) {
        localStorage.removeItem(sessionId);
        setXml(stored);
      } else {
        say({ kind: 'error', message: `No studyflow found for session=${sessionId}.` });
        setPhase('error');
      }
      return;
    }
    if (!studyflowUrl) return;
    fetch(studyflowUrl).then((r) => r.text()).then(setXml).catch((err) => {
      say({ kind: 'error', message: `Failed to fetch ${studyflowUrl}: ${err}` });
      setPhase('error');
    });
  }, [sessionId, studyflowUrl]);

  useEffect(() => {
    if (!xml || ranOnce.current) return;
    ranOnce.current = true;

    (async () => {
      try {
        setPhase('loading');
        const schemas = await executeCommand(null, { type: 'download-schemas' });
        const process = await parseStudyflow(xml, schemas);
        setStudyName(process.businessObject?.name || process.businessObject?.id || null);
        say({
          kind: 'info',
          message: `Parsed ${process.nodes.size} nodes, ${process.edges.size} edges.`,
        });

        const needsBehaverse = requiresBehaverseRuntime(process);
        const manifest = needsBehaverse ? await fetchManifest(BEHAVERSE_RUNTIME_URL) : undefined;
        if (!needsBehaverse) {
          say({ kind: 'info', message: 'No behaverse tasks — skipping Unity manifest.' });
        }

        const issues = validate(process, manifest);
        if (issues.length > 0) {
          for (const i of issues) say({ kind: 'error', message: `${i.nodeId}: ${i.message}` });
          setPhase('invalid');
          return;
        }

        setPhase('running');
        const graph = new Graph(process, { seed });
        graphRef.current = graph;

        for await (const job of graph.traverse()) {
          setCurrentJob(job);
          setPhase(`job:${job.kind}`);
          const outcome = await new Promise<NodeOutcome>((resolve) => {
            resolverRef.current = resolve;
          });
          resolverRef.current = null;
          if (outcome.kind === 'abort') {
            say({ kind: 'error', message: `Aborted at ${job.node.id}: ${outcome.reason}` });
            setPhase('aborted');
            return;
          }
        }
        setPhase('done');
      } catch (err) {
        say({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
        setPhase('error');
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
              log={sayLog}
              setVariable={setVariable}
              onResolve={handleResolve}
            />
          ) : (
            <div className={layout.cover + ' ' + layout.coverShown}>
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
        run.html?studyflow_url=/assets/behaverse.studyflow&seed=42
      </pre>
    </div>
  );
}
