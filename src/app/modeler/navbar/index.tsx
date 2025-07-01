import logo_image from '@/assets/logo.png';
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
      <div className="px-2 self-center gap-1">
          <span className="italic text-lg text-stone-500 border border-dashed rounded-sm px-2 border-stone-300">
            Untitled Study
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
