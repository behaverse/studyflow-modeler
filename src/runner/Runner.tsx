import { useEffect, useRef, useState } from 'react';
import { downloadSchemas } from '@/shared/downloadSchemas';
import {
  parseStudyflow,
  StudyflowEngine,
  fetchManifest,
  validateGraph,
  runOnUnity,
  waitForUnity,
} from './unity';
import type { RuntimeStep } from './unity';

const UNITY_BUILD_URL = '/unity';

// TODO: add a "runnerReady" message from unity once the loading scene transition completes and wait for it here instead of using a fixed grace period.
// TODO: move styles to styles.ts

/**
 * Time to wait after Unity reports ready before sending the first task.
 * Unity's GameManager runs an async startup hook that does
 * `WaitForSeconds(0.5)` before transitioning out of the Loading scene; sending
 * a task during that window aborts the just-loaded scene.
 */
const STARTUP_GRACE_MS = 1000;

type Log = { kind: 'info' | 'task' | 'ok' | 'error'; message: string };

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
        await new Promise((r) => setTimeout(r, STARTUP_GRACE_MS));

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
    <div className="flex flex-col h-screen">
      <header className="bg-fuchsia-700 text-white px-4 py-2 flex items-center gap-3">
        <span className="font-semibold">Studyflow Runner</span>
        <span className="text-xs uppercase bg-white/20 rounded px-2 py-0.5">{phase}</span>
        {seed != null && <span className="text-xs opacity-75">seed={seed}</span>}
      </header>
      <main className="flex flex-1 min-h-0">
        <iframe
          ref={iframeRef}
          src={`${UNITY_BUILD_URL}/index.html`}
          title="Behaverse Assessment"
          className="flex-1 bg-black border-0"
          allow="autoplay; fullscreen"
        />
        <aside className="w-80 bg-stone-100 border-l border-stone-300 overflow-y-auto p-3 text-sm">
          <h2 className="font-semibold mb-2">Activity</h2>
          <ol className="space-y-1">
            {log.map((entry, i) => (
              <li key={i} className={LOG_COLOR[entry.kind]}>{entry.message}</li>
            ))}
          </ol>
        </aside>
      </main>
    </div>
  );
}

const LOG_COLOR: Record<Log['kind'], string> = {
  info: 'text-stone-700',
  task: 'text-fuchsia-700',
  ok: 'text-emerald-700',
  error: 'text-red-700',
};

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
    <div className="p-6 max-w-xl mx-auto">
      <h1 className="text-2xl font-semibold mb-3">Studyflow Runner</h1>
      <p className="mb-4 text-stone-700">
        Pass a <code>studyflowUrl</code> query parameter pointing to a
        <code>.studyflow</code> file.
      </p>
      <pre className="bg-stone-100 p-3 text-xs">
        run.html?studyflowUrl=/assets/behaverse.studyflow&seed=42
      </pre>
    </div>
  );
}
