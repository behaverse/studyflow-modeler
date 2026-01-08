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
    <div className="fixed top-4 left-4 z-2 flex items-center gap-1">
        <a href="../" className="flex items-center gap-2 flex-shrink-0" target="_blank" >
          <img src={logo_image} className="h-12 w-12" alt="Studyflow Modeler" title="Studyflow Modeler" />
        </a>
          <span className="text-md leading-none select-none mr-8 text-violet-700">
            <span className="font-light">Studyflow</span><br />
            <span className="font-semibold">Modeler</span>
          </span>
        <nav className="inline-flex items-center p-2 h-12 bg-stone-100 border-2 border-stone-200 rounded-2xl overflow-x-auto">
          <div className="flex items-center gap-1">
              <span className="text-lg text-stone-500 border border-dashed rounded-lg px-2 border-stone-300">
                {isEditingDiagramName ? (
                  <input
                    type="text"
                    value={diagramName}
                    onChange={(e) =>
                      (e.target.value.length > 0)?
                        setDiagramName(e.target.value):undefined
                    }
                    onBlur={() => setIsEditingDiagramName(false)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        setIsEditingDiagramName(false);
                      }
                    }}
                    autoFocus
                    maxLength={120}
                    minLength={1}
                    className="text-black font-semibold bg-transparent rounded-lg"
                  />
                ) : (
                  <span className="font-semibold cursor-pointer"
                    title="Click to edit diagram name"
                    onClick={() => setIsEditingDiagramName(true)}>
                    {diagramName}</span>
                )}
              </span>
            {modeler && <MenuBar />}
          </div>
      </nav>
    </div>
    </DiagramNameContext.Provider>
);
}
