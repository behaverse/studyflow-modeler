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
    'bg-fuchsia-700 hover:bg-fuchsia-900 border-fuchsia-800');

  useEffect(() => {
    // print all  the injected dependencies to the console
    console.log('modeler:', modeler);
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
      setClassNames('bg-green-700 hover:bg-green-900 border-green-800');
    } else {
      setLabel('Simulate');
      classes(modeler._container).remove('simulation');
      classes(palette._container).remove('hidden');
      setClassNames('bg-fuchsia-700 hover:bg-fuchsia-900 border-fuchsia-800');
    }
  }

  return (
      <button
        className={"text-white font-semibold py-1 px-4 rounded-s border " + classNames}
        onClick={toggleSimulation}>
          <i className="bi bi-camera-reels w-3 h-3 me-2"></i>
          {label}</button>
  );

}
