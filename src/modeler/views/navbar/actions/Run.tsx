import { useState } from 'react';
import { useModeler } from '@/modeler/views/useModeler';
import { executeCommand } from '@/modeler/controllers/commandBus';

const BUTTON_CLS = 'inline-flex items-center justify-center gap-1.5 text-[13px] font-semibold rounded-r-lg h-7 px-3.5 transition-colors text-white bg-[#520BBF] hover:bg-[#4309A2] disabled:opacity-50 disabled:cursor-wait';

export function RunButton() {
  const modeler = useModeler();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (!modeler || busy) return;
    setBusy(true);
    try { await executeCommand(modeler, { type: 'open-runner' }); } finally { setBusy(false); }
  }

  return (
    <button
      type="button"
      title="Run the current diagram in a new tab"
      disabled={busy}
      className={BUTTON_CLS}
      onClick={handleClick}
    >
      Run
    </button>
  );
}
