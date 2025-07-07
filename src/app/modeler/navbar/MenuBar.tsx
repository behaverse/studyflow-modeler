import { Menu, MenuItems, MenuButton, MenuItem, MenuSeparator } from '@headlessui/react'
import { ExportButton } from './actions/Export';
import { PublishButton, PublishDialog } from './actions/Publish';
import { SaveButton } from './actions/Save';
import { OpenButton } from './actions/Open';
import { SimulateButton } from './actions/Simulate';
import { NewDiagramButton } from './actions/NewDiagram';
import React, { useRef } from 'react';

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
        <MenuButton className="hover:bg-stone-300 rounded px-2">File</MenuButton>
        <MenuItems  unmount={false} anchor="bottom start" className="min-w-48 bg-stone-100 border border-stone-300 rounded-md grid auto-rows-max grid-flow-row">
          <MenuItem className="px-3 py-1 hover:bg-stone-300" as={NewDiagramButton} />
          <MenuItem className="px-3 py-1 hover:bg-stone-300" as={OpenButton} />
          <MenuItem className="px-3 py-1 hover:bg-stone-300" as={SaveButton} />
          <MenuSeparator className="h-px bg-stone-300" />
          <MenuItem className="px-3 py-1 hover:bg-stone-300" as={ExportButton} fileType="svg" />
          <MenuItem className="px-3 py-1 hover:bg-stone-300" as={ExportButton} fileType="png" />
          <MenuSeparator className="h-px bg-stone-300" />
          <MenuItem className="px-3 py-1 hover:bg-stone-300" as={PublishButton} dialog={publishDialogRef}  />
        </MenuItems>
      </Menu>
      <Menu as="div" title="ViewMenu" className="">
        <MenuButton className="hover:bg-stone-300 rounded px-2">View</MenuButton>
        <MenuItems anchor="bottom start" className="min-w-36 bg-stone-100 border border-stone-300 rounded-md grid auto-rows-max grid-flow-row">
          <MenuItem>
            <a href="#" className="px-3 py-1 hover:bg-stone-300"><i className="bi bi-check-circle-fill pe-2"></i> Study</a>
          </MenuItem>
          <MenuItem>
            <a href="#" className="px-3 py-1 text-stone-500 cursor-not-allowed"><i className="bi bi-circle pe-2"></i> Timeline</a>
          </MenuItem>
          <MenuItem>
            <a href="#" className="px-3 py-1 text-stone-500 cursor-not-allowed"><i className="bi bi-circle pe-2"></i> Checklist</a>
          </MenuItem>
        </MenuItems>
      </Menu>
      <Menu as="div" title="SimulateMeu" className="">
        <SimulateButton className="" />
      </Menu>
      <Menu as="div" title="HelpMenu" className="">
        <MenuButton className="hover:bg-stone-300 rounded px-2">Help</MenuButton>
        <MenuItems anchor="bottom start" className="w-36 bg-stone-100 border border-stone-300 rounded-md grid auto-rows-max grid-flow-row">
          <MenuItem>
            <a href="../docs" target="_blank" className="px-3 py-1 hover:bg-stone-300">Docs</a>
          </MenuItem>
          <MenuItem>
            <a href="https://github.com/behaverse/studyflow-modeler" target="_blank" className="px-3 py-1 hover:bg-stone-300">GitHub</a>
          </MenuItem>
          <MenuItem>
            <a href="../about/" target="_blank" className="px-3 py-1 hover:bg-stone-300">About</a>
          </MenuItem>
        </MenuItems>
      </Menu>

    </div>
  );


}
