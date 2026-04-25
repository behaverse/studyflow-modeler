import { Menu, MenuItems, MenuButton, MenuItem, MenuSeparator } from '@headlessui/react';
import { useRef } from 'react';
import { ExportButton } from './actions/Export';
import { PublishButton, PublishDialog } from './actions/Publish';
import { SaveButton } from './actions/Save';
import { OpenButton } from './actions/Open';
import { SimulateButton } from './actions/Simulate';
import { NewDiagramButton } from './actions/NewDiagram';
import { ResetZoomButton } from './actions/ResetZoom';
import { LoginButton, LoginDialog } from './actions/Login';
import { dropdownCls, itemCls, navBtnCls, sepCls } from './styles';

export default function MenuBar() {
  const publishDialogRef = useRef<{ open: () => void }>(null);
  const loginDialogRef = useRef<{ open: () => void }>(null);

  return (
    <div className="flex items-center gap-0.5 mx-1 flex-shrink-0">
      <PublishDialog ref={publishDialogRef} />
      <LoginDialog ref={loginDialogRef} />

      <Menu as="div" title="FileMenu" className="">
        <MenuButton className={navBtnCls}>File</MenuButton>
        <MenuItems unmount={false} anchor="bottom start" className={dropdownCls}>
          <MenuItem className={itemCls} as={NewDiagramButton} />
          <MenuItem className={itemCls} as={OpenButton} />
          <MenuItem className={itemCls} as={SaveButton} />
          <MenuSeparator className={sepCls} />
          <MenuItem className={itemCls} as={ExportButton} fileType="svg" />
          <MenuItem className={itemCls} as={ExportButton} fileType="png" />
          <MenuSeparator className={sepCls} />
          <MenuItem className={itemCls} as={LoginButton} dialog={loginDialogRef} />
          <MenuItem className={itemCls} as={PublishButton} dialog={publishDialogRef} />
        </MenuItems>
      </Menu>

      <Menu as="div" title="ViewMenu" className="">
        <MenuButton className={navBtnCls}>View</MenuButton>
        <MenuItems unmount={false} anchor="bottom start" className={dropdownCls}>
          <MenuItem className={itemCls} as={ResetZoomButton} />
        </MenuItems>
      </Menu>

      <Menu as="div" title="HelpMenu" className="">
        <MenuButton className={navBtnCls}>Help</MenuButton>
        <MenuItems anchor="bottom start" className={dropdownCls}>
          <MenuItem>
            <a href="./docs" target="_blank" className={`block ${itemCls}`}>Docs</a>
          </MenuItem>
          <MenuItem>
            <a href="https://github.com/behaverse/studyflow-modeler" target="_blank" className={`block ${itemCls}`}>GitHub</a>
          </MenuItem>
        </MenuItems>
      </Menu>

      <div className="w-px h-4 bg-white/15 mx-1" />
      <Menu as="div" title="SimulateMenu" className="">
        <SimulateButton className="" />
      </Menu>
    </div>
  );
}
