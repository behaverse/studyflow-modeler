import { useContext } from 'react';
import { ModelerContext, SimulationContext } from '../../contexts';
import { executeCommand } from '../../commands';

type Props = {
  className?: string;
};

export function SimulateButton({ className = '' }: Props) {
  const { modeler } = useContext(ModelerContext);
  const { isSimulating, setIsSimulating } = useContext(SimulationContext);

  function toggleSimulation() {
    executeCommand(modeler, {
      type: 'toggle-simulation',
      currentActive: isSimulating,
    });
    setIsSimulating(!isSimulating);
  }

  return (
    <button
      type="button"
      title={isSimulating ? 'Stop simulation' : 'Simulate the studyflow'}
      className={[
        'inline-flex items-center justify-center gap-1.5',
        // `rounded-l-lg` only - paired with the Run button on the right,
        // so the inner edge is flush. Outer arc still nests inside the
        // navbar's 12px corner with 6px padding.
        'text-[13px] font-semibold rounded-l-lg h-7 px-3.5 transition-colors',
        isSimulating
          ? 'text-white bg-red-700 hover:bg-red-800'
          : 'text-white bg-[#C028B0] hover:bg-[#A32295]',
        className,
      ].join(' ')}
      onClick={toggleSimulation}
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
