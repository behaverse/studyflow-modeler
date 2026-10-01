import { useEffect, useRef, useState } from 'react';
import { readString, type FlowNode } from '@runner/flow';
import type { NodeProps } from '@runner/nodes/types';
import { registerNode } from '@runner/nodes/registry';
import { timelineOf, trialOf, type JsPsychTrial } from '@skills/jspsych/browser/trial';

/* A step whose `implementation` is `jspsych://<plugin>@<version>` plays that jsPsych plugin with the Parameters wired
   into it, and its result is the trials' data, one row a trial. */

declare module '@runner/jobs' {
  interface JobsByType {
    jspsych: JsPsychJob;
  }
}

type JsPsychJob = { type: 'jspsych'; node: FlowNode; trial: JsPsychTrial };

type JsPsychModule = {
  initJsPsych(options: { display_element: HTMLElement; on_finish: () => void }): {
    run(timeline: unknown[]): Promise<void>;
    timelineVariable(name: string): unknown;
    data: { get(): { values(): Record<string, unknown>[] } };
  };
};

const loaded = new Map<string, Promise<void>>();

/** A script or stylesheet, added to the page once. */
function load(url: string): Promise<void> {
  if (!loaded.has(url)) {
    loaded.set(url, new Promise<void>((resolve, reject) => {
      const tag = url.endsWith('.css') ? Object.assign(document.createElement('link'), { rel: 'stylesheet', href: url }) : Object.assign(document.createElement('script'), { src: url });
      tag.onload = () => resolve();
      tag.onerror = () => { loaded.delete(url); reject(new Error(`could not load ${url}`)); };
      document.head.append(tag);
    }));
  }
  return loaded.get(url)!;
}

function JsPsych({ job, session, log, complete, abort }: NodeProps<JsPsychJob>) {
  const stage = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('Loading jsPsych...');

  useEffect(() => {
    let cancelled = false;
    const { trial } = job;
    (async () => {
      try {
        await Promise.all([load(trial.core.css), load(trial.core.script)]);
        await load(trial.script);
        if (cancelled || !stage.current) return;
        const globals = window as unknown as Record<string, unknown>;
        const { initJsPsych } = globals.jsPsychModule as JsPsychModule;
        const plugin = globals[trial.global];
        if (!plugin) throw new Error(`the ${trial.plugin} plugin set no ${trial.global}`);
        setStatus('');
        const jsPsych = initJsPsych({ display_element: stage.current, on_finish: () => undefined });
        log('task', `jsPsych ${trial.version}: ${trial.plugin}`);
        await jsPsych.run([timelineOf(plugin, job.node.parameters, (name) => jsPsych.timelineVariable(name))]);
        if (cancelled) return;
        session.answer(jsPsych.data.get().values());
        complete();
      } catch (error) {
        if (!cancelled) abort(`jsPsych: ${(error as Error).message}`);
      }
    })();
    return () => { cancelled = true; };
  }, [job, session, log, complete, abort]);

  return (
    <div className="relative flex-1 h-full w-full">
      {status && <p className="absolute inset-0 flex items-center justify-center text-stone-500 text-sm">{status}</p>}
      <div ref={stage} className="h-full w-full" />
    </div>
  );
}

registerNode({
  type: 'jspsych',
  heavy: true,
  match: { scheme: 'jspsych' },
  toJob: (node) => {
    const trial = trialOf(readString(node, 'implementation'));
    return 'error' in trial ? null : { type: 'jspsych', node, trial };
  },
  Component: JsPsych,
  validateNode: (node) => {
    const trial = trialOf(readString(node, 'implementation'));
    return 'error' in trial ? [{ nodeId: node.id, message: trial.error }] : [];
  },
});
