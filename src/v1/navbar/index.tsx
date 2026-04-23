import logo_image from '@/assets/img/logo.png';
import { useState, useContext, useEffect } from 'react';
import { DiagramNameContext, ModelerContext } from '../contexts';
import MenuBar from './MenuBar';

export function NavBar(props) {

  const { modeler } = useContext(ModelerContext);
  const injector = modeler.get('injector');
  const eventBus = injector.get('eventBus');
  const [diagramName, setDiagramName] = useState('Untitled Diagram');
  const [isEditingDiagramName, setIsEditingDiagramName] = useState(false);

  useEffect(() => {
    const onRootChanged = (e) => {
      // setDiagramName(modeler._definitions.get('id') || 'Untitled Study');
    };

    eventBus.on('root.set', onRootChanged);

    return () => {
      eventBus.off('root.set', onRootChanged);
    };
  }, [modeler, diagramName, eventBus]);

  return (
    <DiagramNameContext.Provider value={{ diagramName, setDiagramName }}>
    <div className="fixed top-0 left-1/2 -translate-x-1/2 z-50 flex items-center h-9 max-w-[calc(100vw-16px)]
                    rounded-b-[14px] bg-white/55 backdrop-blur-2xl
                    border border-white/45
                    shadow-[0_2px_8px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.07),inset_0_1px_0_rgba(255,255,255,0.85)]
                    opacity-90 hover:opacity-100 transition-opacity">
      <a href="../" className="flex items-center gap-2 px-3 h-full border-r border-black/6 flex-shrink-0" target="_blank">
        <img src={logo_image} className="h-5 w-5" alt="Studyflow" title="Studyflow Modeler" />
        <span className="text-[13px] font-semibold text-stone-800 leading-none tracking-tight select-none">Studyflow</span>
      </a>

      <div className="flex items-center px-2 min-w-0 flex-shrink">
        {isEditingDiagramName ? (
          <input
            type="text"
            value={diagramName}
            onChange={(e) => (e.target.value.length > 0) ? setDiagramName(e.target.value) : undefined}
            onBlur={() => setIsEditingDiagramName(false)}
            onKeyDown={(e) => { if (e.key === 'Enter') setIsEditingDiagramName(false); }}
            autoFocus
            maxLength={120}
            minLength={1}
            className="text-[13px] font-medium text-stone-800 bg-black/5 rounded-md px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-black/15"
          />
        ) : (
          <span
            className="text-[13px] font-medium text-stone-700 cursor-pointer px-2 py-1 rounded-md hover:bg-black/5 transition-colors truncate"
            title="Click to edit diagram name"
            onClick={() => setIsEditingDiagramName(true)}
          >{diagramName}</span>
        )}
      </div>

      {modeler && <MenuBar />}
    </div>
    </DiagramNameContext.Provider>
);
}
