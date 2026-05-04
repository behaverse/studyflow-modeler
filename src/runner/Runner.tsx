import { useEffect, useRef, useState } from 'react';
import { downloadSchemas } from '@/shared/downloadSchemas';
import { parseStudyflow } from './parser';
import { StudyflowEngine } from './engine';
import type { RuntimeStep } from './types';
import {
  fetchManifest,
  validateGraph,
  runOnUnity,
  waitForUnity,
  waitForRunnerReady,
  buildBehaverseIframeSrc,
  BEHAVERSE_RUNTIME_URL,
} from './behaverse';
import { layout, logColor, type LogKind } from './styles';

/** Fallback delay if the Behaverse runtime never sends `studyflow:runnerReady`. */
const STARTUP_GRACE_MS = 1000;

// Time the cover is shown while the Behaverse runtime loads the task scene.
// Bumped from 300ms so a slow venue projector / WiFi has room to swap from the
// loading scene to the first task without the audience seeing a flash of the menu.
const STAGE_REVEAL_DELAY_MS = 1500;

type Log = { kind: LogKind; message: string };

export function Runner() {
  const params = new URLSearchParams(window.location.search);
  const studyflowUrl = params.get('studyflowUrl') ?? '';
  const seed = params.get('seed') ? Number(params.get('seed')) : undefined;
  const bot = params.get('bot');
  const behaverseIframeSrc = buildBehaverseIframeSrc(bot);

  const [xml, setXml] = useState<string | null>(null);
  const [phase, setPhase] = useState('idle');
  const [log, setLog] = useState<Log[]>([]);
  const [stageReady, setStageReady] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const ranOnce = useRef(false);

  const say = (entry: Log) => setLog((prev) => [...prev, entry]);

  // Fetch XML when a `studyflowUrl` is provided.
  useEffect(() => {
    if (!studyflowUrl) return;
    fetch(studyflowUrl).then((r) => r.text()).then(setXml).catch((err) => {
      say({ kind: 'error', message: `Failed to fetch ${studyflowUrl}: ${err}` });
      setPhase('error');
      setStageReady(true);
    });
  }, [studyflowUrl]);

  useEffect(() => {
    if (!xml || ranOnce.current) return;
    ranOnce.current = true;

    (async () => {
      try {
        setPhase('loading');
        const [schemas, manifest] = await Promise.all([
          downloadSchemas(),
          fetchManifest(BEHAVERSE_RUNTIME_URL),
        ]);

        const graph = await parseStudyflow(xml, schemas);
        say({ kind: 'info', message: `Parsed ${graph.nodes.size} nodes, ${graph.edges.size} edges.` });

        const issues = validateGraph(graph, manifest);
        if (issues.length > 0) {
          for (const i of issues) say({ kind: 'error', message: `${i.nodeId}: ${i.message}` });
          setPhase('invalid');
          setStageReady(true);
          return;
        }

        // Each studyflow task is an independent activity. Unity tears down
        // (Application.Quit fires) after each completed task, so we treat
        // every task as its own iframe lifecycle: reload the iframe, wait for
        // a fresh Unity instance, dispatch the task, await completion, repeat.
        // This avoids racing the next SendMessage against a half-destroyed
        // GameManager from the previous task.
        setPhase('running');
        const engine = new StudyflowEngine(graph, { seed });
        const noopUnity = { SendMessage: () => undefined } as Awaited<ReturnType<typeof waitForUnity>>;
        let taskNumber = 0;
        for await (const step of engine.run()) {
          let unity: Awaited<ReturnType<typeof waitForUnity>> = noopUnity;
          if (step.kind === 'task') {
            taskNumber += 1;
            // Each task gets a fresh Unity iframe lifecycle. First task: the
            // iframe mounted at initial render is reused. Subsequent tasks:
            // bump the React key so the iframe remounts, then wait for a
            // fresh Unity instance. This avoids racing against the previous
            // task's Application.Quit teardown.
            if (taskNumber > 1) {
              setStageReady(false);
              setPhase(`reloading behaverse (task ${taskNumber})`);
              setIframeKey((k) => k + 1);
              await new Promise((r) => setTimeout(r, 50));
            } else {
              setPhase('awaiting behaverse');
            }
            unity = await waitForUnity(() => iframeRef.current);
            const result = await waitForRunnerReady(() => iframeRef.current);
            if (result === 'timeout') await new Promise((r) => setTimeout(r, STARTUP_GRACE_MS));
            setPhase(`running task ${taskNumber}`);
            setTimeout(() => setStageReady(true), STAGE_REVEAL_DELAY_MS);
          }
          await runStep(step, unity, say, () => iframeRef.current?.contentWindow ?? null);
        }
        setPhase('done');
        setStageReady(true);
      } catch (err) {
        say({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
        setPhase('error');
        setStageReady(true);
      }
    })();
  }, [xml, seed]);

  if (!xml) return <Help onFileLoaded={setXml} />;

  return (
    <div className={layout.page}>
      <header className={layout.header}>
        <span className={layout.title}>Studyflow Runner</span>
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
          <iframe
            key={iframeKey}
            ref={iframeRef}
            src={behaverseIframeSrc}
            title="Behaverse Assessment"
            className={layout.iframe}
            allow="autoplay; fullscreen"
          />
          <div className={`${layout.cover} ${stageReady ? layout.coverHidden : layout.coverShown}`}>
            <span>Preparing study... ({phase})</span>
          </div>
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

async function runStep(
  step: RuntimeStep,
  unity: Awaited<ReturnType<typeof waitForUnity>>,
  say: (entry: Log) => void,
  getUnityWindow: () => Window | null,
): Promise<void> {
  if (step.kind !== 'task') {
    const label = step.node.businessObject?.name || step.node.id;
    const isStubbed = step.kind === 'questionnaire' || step.kind === 'instruction';
    say({
      kind: isStubbed ? 'skip' : 'info',
      message: isStubbed
        ? `Skipped ${step.kind} "${label}" — execution not implemented in v1.`
        : `${step.kind}: ${label}`,
    });
    return;
  }
  say({ kind: 'task', message: `Run ${step.payload.task} / ${step.payload.timeline ?? '(inline)'}` });
  const done = await runOnUnity(unity, step.payload, getUnityWindow as any);
  say({
    kind: done.isCompleted ? 'ok' : 'error',
    message: `${done.isCompleted ? 'Completed' : 'Aborted'} ${done.taskId} / ${done.timelineId}`,
  });
}

function Help({ onFileLoaded }: { onFileLoaded: (xml: string) => void }) {
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then(onFileLoaded);
  };

  return (
    <div className={layout.helpPage}>
      <h1 className={layout.helpTitle}>Studyflow Runner</h1>
      <p className={layout.helpText}>
        Upload a <code>.studyflow</code> file, or pass a <code>studyflowUrl</code> query parameter.
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
        run.html?studyflowUrl=/assets/behaverse.studyflow&seed=42
      </pre>
    </div>
  );
}
