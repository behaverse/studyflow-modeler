import { useContext, useState } from 'react';
import { ModelerContext } from '../../contexts';

type Props = {
  className?: string;
};

const SEED = 42;

/**
 * Opens the standalone Runner (`run.html`) in a new tab with the current
 * diagram handed off via localStorage. Unsaved diagrams work too: we
 * serialize from the live modeler instead of disk.
 */
export function RunButton({ className = '' }: Props) {
  const { modeler } = useContext(ModelerContext);
  const [busy, setBusy] = useState(false);

  async function openRunner() {
    if (!modeler || busy) return;
    setBusy(true);
    try {
      const { xml } = await modeler.saveXML({ format: true });
      // Hand the XML over via localStorage instead of a blob URL: blob URLs
      // are tied to the document that minted them and don't reliably survive
      // a `noopener` popup, leaving the runner with a 404 on its fetch.
      const sessionId = `studyflow-${crypto.randomUUID()}`;
      localStorage.setItem(sessionId, xml);
      const params = new URLSearchParams({ session_id: sessionId, seed: String(SEED) });
      window.open(`./run.html?${params.toString()}`, '_blank', 'noopener');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      title="Run the current diagram in a new tab"
      disabled={busy}
      className={[
        'inline-flex items-center justify-center gap-1.5',
        'text-[13px] font-semibold rounded-r-lg h-7 px-3.5 transition-colors',
        'text-white bg-[#520BBF] hover:bg-[#4309A2] disabled:opacity-50 disabled:cursor-wait',
        className,
      ].join(' ')}
      onClick={openRunner}
    >
      Run
    </button>
  );
}
