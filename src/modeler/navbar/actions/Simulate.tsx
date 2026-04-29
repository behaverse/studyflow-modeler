import { useContext, useState } from 'react';
import { ModelerContext } from '../../contexts';
import { executeCommand } from '../../commands';

type Props = {
  className?: string;
};

export function SimulateButton({ className = '' }: Props) {
  const { modeler } = useContext(ModelerContext);
  const [active, setActive] = useState(false);

  function toggleSimulation() {
    executeCommand(modeler, {
      type: 'toggle-simulation',
      currentActive: active,
    });
    setActive(!active);
  }

  return (
    <button
      type="button"
      title={active ? 'Stop simulation' : 'Simulate the studyflow'}
      className={[
        'inline-flex items-center justify-center gap-1.5',
        'text-[13px] font-semibold rounded-lg h-7 px-3 ',
        active
          ? 'text-white bg-red-700 hover:bg-red-800'
          : 'text-white bg-violet-900 hover:bg-violet-800',
        className,
      ].join(' ')}
      onClick={toggleSimulation}
    >
      {active ? (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
          <rect x="2" y="2" width="12" height="12" rx="1.5" />
        </svg>
      ) : (
        'Simulate'
      )}
    </button>
  );
}
