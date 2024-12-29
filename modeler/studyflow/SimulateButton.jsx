import {classes} from 'min-dom';
import { useEffect, useContext, useState } from "react";
import {StudyFlowContext} from '../StudyFlowContext';


import {
  TOGGLE_MODE_EVENT
} from 'bpmn-js-token-simulation/lib/util/EventHelper';

export default function SimulateButton() {

  const modeler = useContext(StudyFlowContext);
  const [active, setActive] = useState(true);
  const [label, setLabel] = useState('Simulate');

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
    } else {
      setLabel('Simulate');
      classes(modeler._container).remove('simulation');
      classes(palette._container).remove('hidden');
    }
  }

  return (
    <div className="fixed top-20 left-28">
      <button
        className="bg-fuchsia-700 hover:bg-fuchsia-900 text-white font-bold py-1 px-4 rounded"
        onClick={toggleSimulation}>{label}</button>
    </div>
  );

}
