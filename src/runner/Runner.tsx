import { useEffect, useRef, useState } from 'react';
import { executeCommand } from '@/v1/commands';
import {
  parseStudyflow,
  StudyflowEngine,
  fetchManifest,
  validateGraph,
  runOnUnity,
  waitForUnity,
} from './unity';
import type { RuntimeStep, ValidationIssue, Manifest, RuntimeGraph } from './unity';

type Phase = 'idle' | 'loading' | 'validating' | 'invalid' | 'awaiting-unity' | 'running' | 'done' | 'error';

type LogEntry = { kind: 'info' | 'task' | 'completion' | 'error'; message: string; ts: number };

export function Runner() {
  const params = new URLSearchParams(window.location.search);
  const studyflowUrl = params.get('studyflowUrl') ?? '';
  const unityBuildUrl = params.get('unityBuildUrl') ?? '';
  const seedParam = params.get('seed');
  const seed = seedParam ? Number.parseInt(seedParam, 10) : undefined;

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [unityIframeUrl, setUnityIframeUrl] = useState<string | null>(null);

  const ranOnce = useRef(false);
  const unityIframeRef = useRef<HTMLIFrameElement>(null);

  const append = (entry: Omit<LogEntry, 'ts'>) =>
    setLog((prev) => [...prev, { ...entry, ts: Date.now() }]);

  useEffect(() => {
    if (!studyflowUrl || !unityBuildUrl) {
      setPhase('idle');
      return;
    }
    if (ranOnce.current) return;
    ranOnce.current = true;

    let cancelled = false;

    (async () => {
      try {
        setPhase('loading');
        append({ kind: 'info', message: `Loading studyflow from ${studyflowUrl}` });

        const [schemas, xmlText, manifest] = await Promise.all([
          executeCommand(null, { type: 'download-schemas' }) as Promise<Record<string, any>>,
          fetch(studyflowUrl).then(extractStudyflowXml),
          fetchManifest(unityBuildUrl),
        ]);

        const graph: RuntimeGraph = await parseStudyflow(xmlText, schemas);
        // debug: append graph node types to the activity log for inspection
        append({ kind: 'info', message: `Graph start=${graph.startId} nodes=${Array.from(graph.nodes.values()).map((n) => n.appliedType).join(',')}` });
        append({ kind: 'info', message: `Parsed ${graph.nodes.size} nodes, ${graph.edges.size} edges.` });

        setPhase('validating');
        const found = validateGraph(graph, manifest);
        if (found.length > 0) {
          setIssues(found);
          setPhase('invalid');
          append({ kind: 'error', message: `${found.length} validation issue(s); not starting.` });
          return;
        }
        append({ kind: 'info', message: `Validation passed against ${manifest.tasks.length} known tasks.` });

        const iframeUrl = `${unityBuildUrl.replace(/\/$/, '')}/index.html`;
        append({ kind: 'info', message: `Unity iframe URL: ${iframeUrl}` });
        setUnityIframeUrl(iframeUrl);
        setPhase('awaiting-unity');

        const unity = await waitForUnity(() => unityIframeRef.current);
        if (cancelled) return;
        append({ kind: 'info', message: 'Unity instance ready.' });

        // Give Unity time to leave its Loading scene before sending RunTaskActivity.
        // GameManager.OnRuntimeInitializeAfterSceneLoad waits ~0.5s before transitioning
        // to the menu scene; sending RunTaskActivity inside that window races the
        // pending SceneManager.LoadScene and the just-started task gets aborted.
        await new Promise((r) => setTimeout(r, 1000));
        if (cancelled) return;

        setPhase('running');
        const engine = new StudyflowEngine(graph, { seed });
        for await (const step of engine.run()) {
          if (cancelled) return;
          await handleStep(step, unity, append, () => unityIframeRef.current?.contentWindow as any);
        }
        setPhase('done');
        append({ kind: 'info', message: 'Study complete.' });
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setPhase('error');
        append({ kind: 'error', message: msg });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [studyflowUrl, unityBuildUrl, seed]);

  if (!studyflowUrl || !unityBuildUrl) {
    return <Help />;
  }

  return (
    <div className="flex flex-col h-screen">
      <header className="bg-fuchsia-700 text-white px-4 py-2 flex items-center gap-3">
        <span className="font-semibold">Studyflow Runner</span>
        <PhaseBadge phase={phase} />
        {seed != null && <span className="text-xs opacity-75">seed={seed}</span>}
      </header>

      <main className="flex flex-1 min-h-0">
        <section className="flex-1 bg-black">
          {unityIframeUrl ? (
            <iframe
              ref={unityIframeRef}
              src={unityIframeUrl}
              title="Behaverse Assessment"
              className="w-full h-full border-0"
              allow="autoplay; fullscreen"
            />
          ) : (
            <div className="text-white p-6">Preparing…</div>
          )}
        </section>

        <aside className="w-80 bg-stone-100 border-l border-stone-300 overflow-y-auto p-3 text-sm">
          {phase === 'invalid' && <IssueList issues={issues} />}
          {error && <div className="text-red-700 mb-3">{error}</div>}
          <h2 className="font-semibold mb-2">Activity</h2>
          <ol className="space-y-1">
            {log.map((entry, i) => (
              <li key={i} className={entryClass(entry.kind)}>
                {entry.message}
              </li>
            ))}
          </ol>
        </aside>
      </main>
    </div>
  );
}

async function handleStep(
  step: RuntimeStep,
  unity: Awaited<ReturnType<typeof waitForUnity>>,
  append: (entry: { kind: LogEntry['kind']; message: string }) => void,
  getUnityWindow: () => any,
): Promise<void> {
  if (step.kind === 'start') {
    append({ kind: 'info', message: `Start: ${step.node.id}` });
    return;
  }
  if (step.kind === 'end') {
    append({ kind: 'info', message: `End: ${step.node.id}` });
    return;
  }
  if (step.kind === 'task') {
    append({
      kind: 'task',
      message: `Run ${step.payload.task}` + (step.payload.timeline ? ` / ${step.payload.timeline}` : ' (inline)'),
    });
    const completion = await runOnUnity(unity, step.payload, getUnityWindow);
    append({
      kind: 'completion',
      message: `Completed ${completion.taskId} / ${completion.timelineId} — ${completion.isCompleted ? 'ok' : 'aborted'}`,
    });
    return;
  }
  if (step.kind === 'instruction') {
    append({ kind: 'info', message: `Instruction: ${step.content.slice(0, 80)}` });
    return;
  }
  if (step.kind === 'questionnaire') {
    append({ kind: 'info', message: `Questionnaire (${step.instrument ?? 'unknown'}) — not yet wired` });
    return;
  }
}

async function extractStudyflowXml(response: Response): Promise<string> {
  if (!response.ok) {
    throw new Error(`Failed to fetch studyflow: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  const trimmed = text.trimStart();
  if (trimmed.startsWith('<svg') || trimmed.startsWith('<?xml') && text.includes('<svg')) {
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(text, 'image/svg+xml');
    const studyflowEl = svgDoc.querySelector('metadata > studyflow');
    if (studyflowEl) return studyflowEl.innerHTML;
  }
  return text;
}

function PhaseBadge({ phase }: { phase: Phase }) {
  const label: Record<Phase, string> = {
    idle: 'idle',
    loading: 'loading',
    validating: 'validating',
    invalid: 'invalid',
    'awaiting-unity': 'awaiting unity',
    running: 'running',
    done: 'done',
    error: 'error',
  };
  return <span className="text-xs uppercase tracking-wide bg-white/20 rounded px-2 py-0.5">{label[phase]}</span>;
}

function IssueList({ issues }: { issues: ValidationIssue[] }) {
  return (
    <div className="mb-3">
      <h2 className="font-semibold text-red-700 mb-1">Validation issues</h2>
      <ul className="space-y-1 text-xs">
        {issues.map((i, idx) => (
          <li key={idx}>
            <code>{i.nodeId}</code>: {i.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Help() {
  return (
    <div className="p-6 max-w-xl mx-auto">
      <h1 className="text-2xl font-semibold mb-3">Studyflow Runner</h1>
      <p className="mb-4 text-stone-700">
        Provide both <code>studyflowUrl</code> and <code>unityBuildUrl</code> as query parameters.
      </p>
      <pre className="bg-stone-100 p-3 text-xs overflow-x-auto">
        run.html?studyflowUrl=/diagrams/smoke.studyflow&unityBuildUrl=/build&seed=42
      </pre>
    </div>
  );
}

function entryClass(kind: LogEntry['kind']): string {
  switch (kind) {
    case 'task': return 'text-fuchsia-700';
    case 'completion': return 'text-emerald-700';
    case 'error': return 'text-red-700';
    default: return 'text-stone-700';
  }
}
