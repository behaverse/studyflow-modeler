import { useModeler } from '@/modeler/views/useModeler';
import { executeCommand } from '@/modeler/controllers/commandBus';
import { useIsSimulating } from '@/modeler/views/simulation/useIsSimulating';

// Left half of the Simulate/Run pair - only the left corners are rounded.
const BASE = 'inline-flex items-center justify-center gap-1.5 text-[13px] font-semibold rounded-l-lg h-7 px-3.5 transition-colors text-white';
const ACTIVE = 'bg-red-700 hover:bg-red-800';
const IDLE = 'bg-[#C028B0] hover:bg-[#A32295]';

export function SimulateButton() {
  const modeler = useModeler();
  const isSimulating = useIsSimulating(modeler);

  return (
    <button
      type="button"
      title={isSimulating ? 'Stop simulation' : 'Simulate the studyflow'}
      className={`${BASE} ${isSimulating ? ACTIVE : IDLE}`}
      onClick={() => executeCommand(modeler, { type: 'toggle-simulation' })}
    >
      {isSimulating ? (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
          <rect x="2" y="2" width="12" height="12" rx="1.5" />
        </svg>
      ) : (
        'Simulate'
      )}
    </button>
  );
}
