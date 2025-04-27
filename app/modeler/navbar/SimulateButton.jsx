import {classes} from 'min-dom';
import { useEffect, useContext, useState } from "react";
import {ModelerContext} from '../contexts';

import {
  TOGGLE_MODE_EVENT
} from 'bpmn-js-token-simulation/lib/util/EventHelper';

export default function SimulateButton(props) {

  const {modeler} = useContext(ModelerContext);
  const [active, setActive] = useState(true);
  const [label, setLabel] = useState('Simulate');
  const [classNames, setClassNames] = useState(
    'text-stone-900 bg-stone-200 hover:bg-stone-300 border-stone-300');

  function toggleSimulation() {
    setActive(!active);
    const eventBus = modeler.get('eventBus');
    const palette = modeler.get('palette');
    eventBus.fire(TOGGLE_MODE_EVENT, { active });
    if (active) {
      setLabel('Stop Simulation');
      classes(modeler._container).add('simulation');
      classes(palette._container).add('hidden');
      setClassNames('text-white bg-red-600 hover:bg-red-700 border-red-700');
    } else {
      setLabel('Simulate');
      classes(modeler._container).remove('simulation');
      classes(palette._container).remove('hidden');
      setClassNames('text-stone-900 bg-stone-200 hover:bg-stone-300 border-stone-300');
    }
  }

  return (
      <button
        title="Simulate the studyflow"
        className={"shadow-sm font-semibold py-1 px-3 rounded border " + classNames}
        onClick={toggleSimulation}>
          <i className="bi bi-camera-reels me-2"></i>
          {label}</button>
  );

}
