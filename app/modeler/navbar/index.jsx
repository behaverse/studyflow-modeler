import logo_image from '../../assets/logo.png';
import { useContext } from 'react';
import { ModelerContext } from '../contexts';
import MenuBar from './MenuBar';

export function NavBar(props) {

  const { modeler } = useContext(ModelerContext);
  
  return (
    <nav className="w-full flow-root bg-stone-100 border-b border-stone-200">
    <div className="float-left flex flex-wrap">
      <a href="../" className="flex space-x-2">
        <img src={logo_image} className="h-16 p-1" alt="Logo" />
      </a>
      <div className="grid grid-flow-row auto-rows-max px-2 h-full self-center gap-1">
          <span className="font-light text-lg text-stone-700 border border-dashed px-2">
            Untitled diagram
            <i className="bi bi-pencil text-stone-500 ps-2"></i>
          </span>
        {modeler && <MenuBar />}
      </div>
    </div>
      <div className="flex flex-wrap float-end h-full items-center p-3">
      <span className="self-center font-light text-2xl text-stone-700">Studyflow<span className="font-semibold">Modeler</span></span>
    </div>
  </nav>
);
}
