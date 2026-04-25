import logo_image from '@/assets/img/logo.png';
import { useState, useContext } from 'react';
import { DiagramNameContext, ModelerContext } from '../contexts';
import MenuBar from './MenuBar';

export function NavBar() {
  const { modeler } = useContext(ModelerContext);
  const [diagramName, setDiagramName] = useState('Untitled Diagram');
  const [isEditingDiagramName, setIsEditingDiagramName] = useState(false);

  return (
    <DiagramNameContext.Provider value={{ diagramName, setDiagramName }}>
      <a
        href="../"
        target="_blank"
        className="fixed top-2 left-[-10px] z-50 flex items-center gap-2.5 px-4 h-12 select-none"
      >
        <img src={logo_image} className="h-12 w-12" alt="Studyflow Modeler" title="Studyflow Modeler" />
        <span className="text-md leading-none select-none text-violet-800">
          <span className="font-light">Studyflow</span>
          <br />
          <span className="font-semibold">Modeler</span>
        </span>
      </a>

      <div
        className="fixed top-0 left-1/2 -translate-x-1/2 z-50 flex items-center h-9 max-w-[calc(100vw-16px)]
                   rounded-b-[14px] bg-stone-800/90 backdrop-blur-2xl
                   border border-white/12
                   shadow-[0_2px_8px_rgba(0,0,0,0.18),0_8px_24px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.10)]
                   opacity-90 hover:opacity-100 transition-opacity"
      >
        <div className="flex items-center px-2 min-w-0 flex-shrink">
          {isEditingDiagramName ? (
            <input
              type="text"
              value={diagramName}
              onChange={(e) =>
                e.target.value.length > 0 ? setDiagramName(e.target.value) : undefined
              }
              onBlur={() => setIsEditingDiagramName(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setIsEditingDiagramName(false);
              }}
              autoFocus
              maxLength={120}
              minLength={1}
              className="text-[13px] font-medium text-stone-100 bg-white/10 rounded-md px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-white/20"
            />
          ) : (
            <span
              className="text-[13px] font-medium text-stone-200 cursor-pointer px-2 py-1 rounded-md hover:bg-white/10 transition-colors truncate"
              title="Click to edit diagram name"
              onClick={() => setIsEditingDiagramName(true)}
            >
              {diagramName}
            </span>
          )}
        </div>

        {modeler && <MenuBar />}
      </div>
    </DiagramNameContext.Provider>
  );
}
