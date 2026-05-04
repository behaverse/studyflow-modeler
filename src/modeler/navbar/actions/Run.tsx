import { useContext, useState } from 'react';
import { ModelerContext } from '../../contexts';

type Props = {
  className?: string;
};

/**
 * Default bot config string forwarded as `?bot=...` on the Runner iframe URL
 * when the "bot" checkbox is on. This is the URL `?bot=` form for stage-demo
 * runs; Unity parses the colon-separated `k:v,k:v` form. Per-task overrides
 * live on each BehaverseTask via `agentMode` + `bot` and ride along inside
 * the RunTaskActivity payload.
 */
const DEFAULT_BOT_CONFIG = 'autoAnswer:Valid,SkipInstructions:true,AutoClickInstructions:true,SkipFocusArea:true,overrideTemporalParameters:true,stimulusDisplayDuration:0.3,interStimulusInterval:0.3,trialForeperiod:0.1,Speed:100';

/**
 * Opens the standalone Runner (`run.html`) in a new tab with the current
 * diagram passed as a Blob URL. Unsaved diagrams work too: we serialize from
 * the live modeler instead of disk. A seed input is exposed so a presenter
 * can deterministically hit different branches of a RandomGateway across
 * re-runs without re-saving. The bot toggle drives Unity's `Bot`
 * MonoBehaviour via the iframe URL so the studyflow can advance arm-to-arm
 * without keyboard input — useful for stage demos.
 */
export function RunButton({ className = '' }: Props) {
  const { modeler } = useContext(ModelerContext);
  const [seed, setSeed] = useState<string>('1');
  const [botModeOn, setBotModeOn] = useState<boolean>(true);
  const [busy, setBusy] = useState(false);

  async function openRunner() {
    if (!modeler || busy) return;
    setBusy(true);
    try {
      const { xml } = await modeler.saveXML({ format: true });
      const blob = new Blob([xml], { type: 'application/xml' });
      const blobUrl = URL.createObjectURL(blob);
      const seedNum = Number(seed);
      const params = new URLSearchParams({ studyflowUrl: blobUrl });
      if (Number.isFinite(seedNum)) params.set('seed', String(seedNum));
      if (botModeOn) params.set('bot', DEFAULT_BOT_CONFIG);
      window.open(`./run.html?${params.toString()}`, '_blank', 'noopener');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex items-center gap-1">
      <label
        title="Auto-answer via the Bot MonoBehaviour. Lets the studyflow advance arm-to-arm without keyboard input — useful for stage demos."
        className="inline-flex items-center gap-1 text-[12px] font-medium text-white/90 select-none cursor-pointer"
      >
        <input
          type="checkbox"
          checked={botModeOn}
          onChange={(e) => setBotModeOn(e.target.checked)}
          className="accent-emerald-400 w-3 h-3"
        />
        bot
      </label>
      <input
        type="number"
        value={seed}
        onChange={(e) => setSeed(e.target.value)}
        title="Random gateway seed"
        aria-label="Seed"
        className="w-12 h-7 text-[12px] font-medium text-white bg-emerald-950/40 border border-emerald-800/60 rounded px-1.5 text-center focus:outline-none focus:ring-1 focus:ring-emerald-400"
      />
      <button
        type="button"
        title="Open the Runner with the current diagram in a new tab"
        disabled={busy}
        className={[
          'inline-flex items-center justify-center gap-1.5',
          'text-[13px] font-semibold rounded-lg h-7 px-3.5 transition-colors',
          'text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-wait',
          className,
        ].join(' ')}
        onClick={openRunner}
      >
        Run
      </button>
    </div>
  );
}
