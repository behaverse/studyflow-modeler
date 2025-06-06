import {classes} from 'min-dom';
import { useEffect, useContext, useState } from "react";
import {ModelerContext} from '../../contexts';

import {
  TOGGLE_MODE_EVENT
} from 'bpmn-js-token-simulation/lib/util/EventHelper';

export function SimulateButton({ propsClassName, ...props }) {

  const {modeler} = useContext(ModelerContext);
  const [active, setActive] = useState(true);
  const [label, setLabel] = useState('Simulate');
  const [classNames, setClassNames] = useState(
    'text-stone-900 hover:bg-stone-300 rounded px-2');

  function toggleSimulation() {
    setActive(!active);
    const eventBus = modeler.get('eventBus');
    const palette = modeler.get('palette');
    eventBus.fire(TOGGLE_MODE_EVENT, { active });
    if (active) {
      setLabel('Stop Simulation');
      classes(modeler._container).add('simulation');
      classes(palette._container).add('hidden');
      setClassNames('text-white bg-red-600 hover:bg-red-700 rounded px-2 border-red-700');
    } else {
      setLabel('Simulate');
      classes(modeler._container).remove('simulation');
      classes(palette._container).remove('hidden');
      setClassNames('text-stone-900 hover:bg-stone-300 rounded px-2');
    }
  }

  return (
    <button
      title="Simulate the studyflow"
      className={`${classNames} ${propsClassName}`}
        onClick={toggleSimulation}>{label}
    </button>
  );

}
