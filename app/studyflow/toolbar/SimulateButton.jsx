import {classes} from 'min-dom';
import { useEffect, useContext, useState } from "react";
import {ModelerContext} from '../ModelerContext';

import {
  TOGGLE_MODE_EVENT
} from 'bpmn-js-token-simulation/lib/util/EventHelper';

export default function SimulateButton() {

  const modeler = useContext(ModelerContext);
  const [active, setActive] = useState(true);
  const [label, setLabel] = useState('Simulate');
  const [classNames, setClassNames] = useState(
    'bg-green-600 hover:bg-green-700 border-green-700');

  useEffect(() => {
  }, [modeler]);

  function toggleSimulation() {
    setActive(!active);
    const eventBus = modeler._injector._instances.eventBus;
    const palette = modeler._injector._instances.palette;
    eventBus.fire(TOGGLE_MODE_EVENT, { active });
    if (active) {
      setLabel('Stop Simulation');
      classes(modeler._container).add('simulation');
      classes(palette._container).add('hidden');
      setClassNames('bg-red-600 hover:bg-red-700 border-red-700');
    } else {
      setLabel('Simulate');
      classes(modeler._container).remove('simulation');
      classes(palette._container).remove('hidden');
      setClassNames('bg-green-600 hover:bg-green-700 border-green-700');
    }
  }

  return (
      <button
        title="Simulate the study flow"
        className={"text-white font-semibold py-1 px-3 rounded border " + classNames}
        onClick={toggleSimulation}>
          <i className="bi bi-camera-reels w-3 h-3 me-2"></i>
          {label}</button>
  );

}
