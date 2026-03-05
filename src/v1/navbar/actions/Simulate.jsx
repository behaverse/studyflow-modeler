import { useContext, useState } from "react";
import { ModelerContext } from '../../contexts';
import { executeCommand } from '../../commands';

export function SimulateButton({ className }) {

  const { modeler } = useContext(ModelerContext);
  const [active, setActive] = useState(false);
  const [label, setLabel] = useState('Simulate');
  const [internalClassNames, setInternalClassNames] = useState(
    'text-stone-200 hover:bg-white/20 rounded px-2');

  function toggleSimulation() {
    const next = !active;
    executeCommand(modeler, {
      type: 'toggle-simulation',
      currentActive: active,
    });
    setActive(next);

    if (next) {
      setLabel('Stop Simulation');
      setInternalClassNames('text-white bg-red-600 hover:bg-red-700 rounded px-2 border-red-700');
    } else {
      setLabel('Simulate');
      setInternalClassNames('text-stone-200 hover:bg-white/20 rounded px-2');
    }
  }

  return (
    <button
      title="Simulate the studyflow"
      className={`${internalClassNames} ${className}`}
      onClick={toggleSimulation}>{label}
    </button>
  );

}
