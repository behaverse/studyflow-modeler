import logo_image from '@/assets/img/logo.png';
import { useState, useContext, useEffect } from 'react';
import { ModelerContext } from '../contexts';
import MenuBar from './MenuBar';

export function NavBar(props) {

  const { modeler } = useContext(ModelerContext);
  const injector = modeler.get('injector');
  const eventBus = injector.get('eventBus');
  const [diagramId, setDiagramId] = useState('Untitled Diagram');

  useEffect(() => {
    const onRootChanged = (e) => {
      // setDiagramId(modeler._definitions.get('id') || 'Untitled Study');
    };

    eventBus.on('root.set', onRootChanged);

    return () => {
      eventBus.off('root.set', onRootChanged);
    };
  }, [modeler, diagramId, eventBus]);

  return (
    <nav className="w-full flow-root bg-stone-100 border-b border-stone-200">
      <div className="float-left flex flex-wrap">
        <a href="../" className="flex space-x-2">
          <img src={logo_image} className="h-16 p-1" alt="Logo" />
        </a>
        <div className="px-2 self-center gap-1">
            <span className="text-lg text-stone-500 border border-dashed rounded-sm px-2 border-stone-300">
              <span className="font-semibold">{diagramId}</span>.studyflow
              <i className="bi bi-pencil text-stone-500 ps-2"></i>
            </span>
          {modeler && <MenuBar />}
        </div>
      </div>
      <a className="grid grid-flow-row auto-rows-max float-end px-2 text-end py-1" href="https://behaverse.org/studyflow-modeler" target="_blank" >
        <span className="font-light text-xl text-stone-700">Studyflow</span>
        <span className="font-semibold text-xl text-stone-800">Modeler</span>
      </a>
    </nav>
);
}
