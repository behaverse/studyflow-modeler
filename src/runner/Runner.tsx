import { useEffect, useRef, useState } from 'react';
import { downloadSchemas } from '@/shared/downloadSchemas';
import {
  parseStudyflow,
  StudyflowEngine,
  fetchManifest,
  validateGraph,
  runOnUnity,
  waitForUnity,
  waitForRunnerReady,
} from './unity';
import type { RuntimeStep } from './unity';
import { layout, logColor, type LogKind } from './styles';

const UNITY_BUILD_URL = '/unity';

/** Fallback delay if the Unity build is too old to emit `studyflow:runnerReady`. */
const STARTUP_GRACE_MS = 1000;

type Log = { kind: LogKind; message: string };

export function Runner() {
  const params = new URLSearchParams(window.location.search);
  const studyflowUrl = params.get('studyflowUrl') ?? '';
  const seed = params.get('seed') ? Number(params.get('seed')) : undefined;

  const [phase, setPhase] = useState('idle');
  const [log, setLog] = useState<Log[]>([]);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const ranOnce = useRef(false);

  const say = (entry: Log) => setLog((prev) => [...prev, entry]);

  useEffect(() => {
    if (!studyflowUrl || ranOnce.current) return;
    ranOnce.current = true;

    (async () => {
      try {
        setPhase('loading');
        const [schemas, xml, manifest] = await Promise.all([
          downloadSchemas(),
          fetch(studyflowUrl).then((r) => r.text()),
          fetchManifest(UNITY_BUILD_URL),
        ]);

        const graph = await parseStudyflow(xml, schemas);
        say({ kind: 'info', message: `Parsed ${graph.nodes.size} nodes, ${graph.edges.size} edges.` });

        const issues = validateGraph(graph, manifest);
        if (issues.length > 0) {
          for (const i of issues) say({ kind: 'error', message: `${i.nodeId}: ${i.message}` });
          setPhase('invalid');
          return;
        }

        setPhase('awaiting unity');
        const unity = await waitForUnity(() => iframeRef.current);

        // Wait for Unity to finish its loading-scene transition before sending
        // the first task. Falls back to a grace period for builds that don't
        // emit the handshake yet.
        const result = await waitForRunnerReady(() => iframeRef.current);
        if (result === 'timeout') await new Promise((r) => setTimeout(r, STARTUP_GRACE_MS));

        setPhase('running');
        const engine = new StudyflowEngine(graph, { seed });
        for await (const step of engine.run()) {
          await runStep(step, unity, say, () => iframeRef.current?.contentWindow ?? null);
        }
        setPhase('done');
      } catch (err) {
        say({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
        setPhase('error');
      }
    })();
  }, [studyflowUrl, seed]);

  if (!studyflowUrl) return <Help />;

  return (
    <div className={layout.page}>
      <header className={layout.header}>
        <span className={layout.title}>Studyflow Runner</span>
        <span className={layout.badge}>{phase}</span>
        {seed != null && <span className={layout.meta}>seed={seed}</span>}
      </header>
      <main className={layout.body}>
        <iframe
          ref={iframeRef}
          src={`${UNITY_BUILD_URL}/index.html`}
          title="Behaverse Assessment"
          className={layout.iframe}
          allow="autoplay; fullscreen"
        />
        <aside className={layout.sidebar}>
          <h2 className={layout.sidebarTitle}>Activity</h2>
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
    say({ kind: 'info', message: `${step.kind}: ${step.node.id}` });
    return;
  }
  say({ kind: 'task', message: `Run ${step.payload.task} / ${step.payload.timeline ?? '(inline)'}` });
  const done = await runOnUnity(unity, step.payload, getUnityWindow as any);
  say({
    kind: done.isCompleted ? 'ok' : 'error',
    message: `${done.isCompleted ? 'Completed' : 'Aborted'} ${done.taskId} / ${done.timelineId}`,
  });
}

function Help() {
  return (
    <div className={layout.helpPage}>
      <h1 className={layout.helpTitle}>Studyflow Runner</h1>
      <p className={layout.helpText}>
        Pass a <code>studyflowUrl</code> query parameter pointing to a
        <code>.studyflow</code> file.
      </p>
      <pre className={layout.helpExample}>
        run.html?studyflowUrl=/assets/behaverse.studyflow&seed=42
      </pre>
    </div>
  );
}
