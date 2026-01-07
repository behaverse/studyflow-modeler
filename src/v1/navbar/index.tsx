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
    <div className="flow-root fixed top-4 left-4 z-2">
      <nav className="bg-stone-100 border border-stone-200 rounded-lg overflow-x-auto">
        <div className="flex flex-nowrap whitespace-nowrap">
          <a href="../" className="flex space-x-2 flex-shrink-0">
            <img src={logo_image} className="h-10 w-10 p-1" alt="Studyflow Modeler" title="Studyflow Modeler" />
          </a>
          <div className="px-2 self-center flex items-center gap-1">
              <span className="text-lg text-stone-500 border border-dashed rounded-sm px-2 border-stone-300">
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
                    className="text-black font-semibold bg-transparent border-none focus:ring-1"
                  />
                ) : (
                    <span className="font-semibold cursor-pointer"
                      onClick={() => setIsEditingDiagramName(true)}
>{diagramName}</span>
                )}
              </span>
            {modeler && <MenuBar />}
          </div>
        </div>
      </nav>
    </div>
    </DiagramNameContext.Provider>
);
}
