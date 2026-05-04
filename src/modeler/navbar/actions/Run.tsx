import { useContext, useState } from 'react';
import { ModelerContext } from '../../contexts';

type Props = {
  className?: string;
};

/**
 * Opens the standalone Runner (`run.html`) in a new tab with the current
 * diagram passed as a Blob URL. Unsaved diagrams work too: we serialize from
 * the live modeler instead of disk. A seed input is exposed so a presenter
 * can deterministically hit different branches of a RandomGateway across
 * re-runs without re-saving. Bot config is per-task in the diagram
 * (`agentMode` + `bot` on each BehaverseTask) and rides inside the
 * RunTaskActivity payload — no URL params.
 */
export function RunButton({ className = '' }: Props) {
  const { modeler } = useContext(ModelerContext);
  const [seed, setSeed] = useState<string>('1');
  const [busy, setBusy] = useState(false);

  async function openRunner() {
    if (!modeler || busy) return;
    setBusy(true);
    try {
      const { xml } = await modeler.saveXML({ format: true });
      // Hand the XML over via localStorage instead of a blob URL: blob URLs
      // are tied to the document that minted them and don't reliably survive
      // a `noopener` popup, leaving the runner with a 404 on its fetch.
      const key = `studyflow-run-${crypto.randomUUID()}`;
      localStorage.setItem(key, xml);
      const seedNum = Number(seed);
      const params = new URLSearchParams({ studyflowKey: key });
      if (Number.isFinite(seedNum)) params.set('seed', String(seedNum));
      window.open(`./run.html?${params.toString()}`, '_blank', 'noopener');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex items-center gap-1">
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
