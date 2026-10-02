import { useEffect } from 'react';
import { readString, type FlowNode } from '@runner/flow';
import type { NodeProps } from '@runner/nodes/types';
import { WaitPanel, type Waiting } from '@runner/nodes/WaitPanel';
import { nodeStyles } from '@runner/nodes/styles';
import { registerNode } from '@runner/nodes/registry';

declare module '@runner/jobs' {
  interface JobsByType {
    rest: RestJob;
  }
}

/** A rest, shown while the walk waits for its timer. */
type RestJob = Waiting & {
  type: 'rest';
  node: FlowNode;
  eyes: string;
};

/** How the participant rests, by the rest's `eyes`. */
const EYES: Record<string, string> = {
  open: 'Rest with your eyes open, looking at the screen.',
  closed: 'Close your eyes and rest.',
  alternating: 'Rest, with your eyes open and closed by turns.',
};

/** A short soft tone, made in the page rather than fetched; a page without audio goes on without it. */
function chime(): void {
  try {
    const audio = new AudioContext();
    const tone = audio.createOscillator();
    const level = audio.createGain();
    tone.frequency.value = 660;
    level.gain.setValueAtTime(0.2, audio.currentTime);
    level.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.6);
    tone.connect(level).connect(audio.destination);
    tone.onended = () => void audio.close();
    tone.start();
    tone.stop(audio.currentTime + 0.6);
  } catch {
    // No audio here: the screen still goes on.
  }
}

function Rest({ job }: NodeProps<RestJob>) {
  // Eyes kept closed cannot see the time run out, so the end of the rest sounds, however it ends.
  const listening = job.eyes !== 'open';
  useEffect(() => () => { if (listening) chime(); }, [listening]);
  return (
    <WaitPanel title={readString(job.node, 'name') || 'Rest'} until={job.until}>
      <p className={nodeStyles.body}>{EYES[job.eyes] ?? EYES.open}</p>
      <p className={nodeStyles.subtitle}>
        {listening ? 'The study goes on by itself when the time is up, with a tone.' : 'The study goes on by itself when the time is up.'}
      </p>
    </WaitPanel>
  );
}

registerNode({
  type: 'rest',
  match: { extensionType: 'cognitive:Rest' },
  toJob: (node) => ({ type: 'rest', node, eyes: readString(node, 'eyes') ?? 'open' }),
  Component: Rest,
});
