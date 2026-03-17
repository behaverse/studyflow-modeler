import logo_image from '@/assets/img/logo.png';
import { useState } from 'react';
import { useModelerStore } from '../store';
import { MenuBar } from './MenuBar';

export function NavBar() {
  const diagramName = useModelerStore((s) => s.diagramName);
  const setDiagramName = useModelerStore((s) => s.setDiagramName);
  const isDirty = useModelerStore((s) => s.isDirty);
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div className="fixed top-1 left-1 z-20 flex items-center gap-1">
      <a href="../" className="flex items-center gap-2 flex-shrink-0" target="_blank">
        <img src={logo_image} className="h-12 w-12" alt="Studyflow Modeler" title="Studyflow Modeler" />
      </a>
      <span className="text-md leading-none select-none me-1 text-violet-800">
        <span className="font-light">Studyflow</span>
        <br />
        <span className="font-semibold">Modeler</span>
      </span>
      <nav className="navbar">
        <div className="flex items-center gap-1">
          <span className="text-lg text-stone-300 border border-dashed rounded-lg px-2 border-stone-500 flex items-center gap-1">
            {isDirty && (
              <span className="inline-block w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" title="Unsaved changes" />
            )}
            {isEditing ? (
              <input
                type="text"
                value={diagramName}
                onChange={(e) => e.target.value.length > 0 && setDiagramName(e.target.value)}
                onBlur={() => setIsEditing(false)}
                onKeyDown={(e) => { if (e.key === 'Enter') setIsEditing(false); }}
                autoFocus
                maxLength={120}
                minLength={1}
                className="text-stone-200 font-semibold bg-white/10 rounded-lg focus:outline-none focus:ring-1 focus:ring-white/30"
              />
            ) : (
              <span
                className="font-semibold cursor-pointer"
                title="Click to edit diagram name"
                onClick={() => setIsEditing(true)}
              >
                {diagramName}
              </span>
            )}
          </span>
          <MenuBar />
        </div>
      </nav>
    </div>
  );
}
