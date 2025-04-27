import logo_image from '../../assets/logo.png';
import { useContext } from 'react';
import { ModelerContext } from '../contexts';
import Menu from './Menu';

export function Navbar(props) {

  const { modeler } = useContext(ModelerContext);
  
  return (
    <nav className="w-full flow-root bg-stone-100 border-b border-dashed border-stone-300">
    <div className="float-left flex flex-wrap">
    <a href="../" className="flex space-x-2">
      <img src={logo_image} className="h-16 p-1" alt="Logo" />
      </a>
      <span className="self-center font-light text-2xl text-stone-700 px-3">
        Studyflow<span className="font-semibold">Modeler</span>
      </span>
      </div>
    <div className="flex flex-wrap float-end h-full items-center p-3">
          {modeler && <Menu />}    
          
      </div>
  </nav>
);
}
