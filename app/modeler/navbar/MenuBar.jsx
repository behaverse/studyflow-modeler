// import PublishButton from './PublishButton';
// import SimulateButton from './SimulateButton';
// import DownloadButton from './DownloadButton';
import {ExportMenuItem} from './Export';
// import OpenButton from './OpenButton';
// import ExtraMenuButton from './ExtraMenuButton';
import { Menu, MenuItems, MenuButton, MenuItem } from '@headlessui/react'

export default function MenuBar(props) {

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
      <Menu as="div" title="FileMenu" className="">
        <MenuButton className="hover:bg-stone-300 rounded px-2">File</MenuButton>
        <MenuItems anchor="bottom start" className="min-w-32 bg-stone-100 border border-stone-300 rounded-md">
          <ExportMenuItem />
        </MenuItems>
      </Menu>
      <Menu as="div" title="HelpMenu">
        <MenuButton className="hover:bg-stone-300 rounded px-2">Help</MenuButton>
        <MenuItems anchor="bottom start" className="min-w-32 bg-white border border-stone-300 rounded-sm">
          <MenuItem>
            <a href="../docs" target="_blank" className="p-2 block data-[focus]:bg-stone-300">Docs</a>
          </MenuItem>
          <MenuItem>
            <a href="https://github.com/behaverse/studyflow-modeler" target="_blank" className="p-2 block data-[focus]:bg-stone-300">GitHub</a>
          </MenuItem>
          <MenuItem>
            <a href="../about/" target="_blank" className="p-2 block data-[focus]:bg-stone-300">About</a>
          </MenuItem>
        </MenuItems>
      </Menu>
    </div>
  );


}
