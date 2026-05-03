import logo_image from '@/assets/img/logo.png';
import { useState, useContext } from 'react';
import { DiagramNameContext, ModelerContext } from '../contexts';
import MenuBar from './MenuBar';
import { navbar } from '../styles';

export function NavBar() {
  const { modeler } = useContext(ModelerContext);
  const [diagramName, setDiagramName] = useState('Untitled Diagram');
  const [isEditingDiagramName, setIsEditingDiagramName] = useState(false);

  return (
    <DiagramNameContext.Provider value={{ diagramName, setDiagramName }}>
      <a
        href="../"
        target="_blank"
        className={navbar.brand}
      >
        <img src={logo_image} className={navbar.brandImage} alt="Studyflow Modeler" title="Studyflow Modeler" />
        <span className={navbar.brandWordmark}>
          <span className={navbar.brandWordmarkLight}>Studyflow</span>
          <br />
          <span className={navbar.brandWordmarkBold}>Modeler</span>
        </span>
      </a>

      <div className={navbar.shell}>
        <div className={navbar.diagramSlot}>
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
              className={navbar.diagramNameInput}
            />
          ) : (
            <span
              className={navbar.diagramName}
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
