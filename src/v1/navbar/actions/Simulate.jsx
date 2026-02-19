import {classes} from 'min-dom';
import { useContext, useState } from "react";
import {ModelerContext} from '../../contexts';

import {
  TOGGLE_MODE_EVENT
} from 'bpmn-js-token-simulation/lib/util/EventHelper';

export function SimulateButton({ className }) {

  const {modeler} = useContext(ModelerContext);
  const [active, setActive] = useState(true);
  const [label, setLabel] = useState('Simulate');
  const [internalClassNames, setInternalClassNames] = useState(
    'text-stone-200 hover:bg-white/20 rounded px-2');

  function toggleSimulation() {
    setActive(!active);
    const eventBus = modeler.get('eventBus');
    const palette = modeler.get('palette');
    eventBus.fire(TOGGLE_MODE_EVENT, { active });
    if (active) {
      setLabel('Stop Simulation');
      classes(modeler._container).add('simulation');
      classes(palette._container).add('hidden');
      setInternalClassNames('text-white bg-red-600 hover:bg-red-700 rounded px-2 border-red-700');
    } else {
      setLabel('Simulate');
      classes(modeler._container).remove('simulation');
      classes(palette._container).remove('hidden');
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
