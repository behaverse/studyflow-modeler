import { Menu, MenuItems, MenuButton, MenuItem, MenuSeparator } from '@headlessui/react'
import { ExportButton } from './actions/Export';
import { PublishButton, PublishDialog } from './actions/Publish';
import { SaveButton } from './actions/Save';
import { OpenButton } from './actions/Open';
import { SimulateButton } from './actions/Simulate';
import { NewDiagramButton } from './actions/NewDiagram';
import { ResetZoomButton } from './actions/ResetZoom';
import React, { useRef, useContext } from 'react';


export default function MenuBar(props) {

    const publishDialogRef = useRef(null);

  // <div className="h-9 inline-flex rounded-md" role="group">
  // <SimulateButton />
  // <span className="w-1"></span>
  // <OpenButton />
  // <DownloadButton />
  // <ExportMenuItem />
  // <span className="w-1"></span>
  // <PublishButton />
  // <ExtraMenuButton />
  // </div>

  return (
    <div className="grid auto-cols-max grid-flow-col">
      <PublishDialog ref={publishDialogRef}  />
      <Menu as="div" title="FileMenu" className="">
        <MenuButton className="hover:bg-white/20 rounded-lg h-8 px-2">File</MenuButton>
        <MenuItems  unmount={false} anchor="bottom start" className="min-w-48 bg-black/80 backdrop-blur-md border border-white/10 text-stone-200 rounded-md grid auto-rows-max grid-flow-row z-50">
          <MenuItem className="px-3 py-1 hover:bg-white/20" as={NewDiagramButton} />
          <MenuItem className="px-3 py-1 hover:bg-white/20" as={OpenButton} />
          <MenuItem className="px-3 py-1 hover:bg-white/20" as={SaveButton} />
          <MenuSeparator className="h-px bg-white/10" />
          <MenuItem className="px-3 py-1 hover:bg-white/20" as={ExportButton} fileType="svg" />
          <MenuItem className="px-3 py-1 hover:bg-white/20" as={ExportButton} fileType="png" />
          <MenuSeparator className="h-px bg-white/10" />
          <MenuItem className="px-3 py-1 hover:bg-white/20" as={PublishButton} dialog={publishDialogRef}  />
        </MenuItems>
      </Menu>
      <Menu as="div" title="ViewMenu" className="">
        <MenuButton className="hover:bg-white/20 rounded-lg h-8 px-2">View</MenuButton>
        <MenuItems unmount={false} anchor="bottom start" className="min-w-36 bg-black/80 backdrop-blur-md border border-white/10 text-stone-200 rounded-md grid auto-rows-max grid-flow-row z-50">
          <MenuItem className="px-3 py-1 hover:bg-white/20" as={ResetZoomButton}  />
        </MenuItems>
      </Menu>
      <Menu as="div" title="SimulateMenu" className="">
        <SimulateButton className=" rounded-lg h-8 px-2" />
      </Menu>
      <Menu as="div" title="HelpMenu" className="">
        <MenuButton className="hover:bg-white/20 px-2 rounded-lg h-8">Help</MenuButton>
        <MenuItems anchor="bottom start" className="w-36 bg-black/80 backdrop-blur-md border border-white/10 text-stone-200 rounded-md grid auto-rows-max grid-flow-row z-50">
          <MenuItem>
            <a href="./docs" target="_blank" className="px-3 py-1 hover:bg-white/20">Docs</a>
          </MenuItem>
          <MenuItem>
            <a href="https://github.com/behaverse/studyflow-modeler" target="_blank" className="px-3 py-1 hover:bg-white/20">GitHub</a>
          </MenuItem>
        </MenuItems>
      </Menu>

    </div>
  );


}
