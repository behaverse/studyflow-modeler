import { Menu, MenuItems, MenuButton, MenuItem, MenuSeparator } from '@headlessui/react';
import { useRef } from 'react';
import { ExportButton } from './actions/Export';
import { PublishButton, PublishDialog } from './actions/Publish';
import { SaveButton } from './actions/Save';
import { OpenButton } from './actions/Open';
import { ExamplesButton, ExamplesDialog } from './actions/Examples';
import { SimulateButton } from './actions/Simulate';
import { RunButton } from './actions/Run';
import { NewDiagramButton } from './actions/NewDiagram';
import { ResetZoomButton } from './actions/ResetZoom';
import { LoginButton, LoginDialog } from './actions/Login';
import { dropdownCls, itemCls, navBtnCls, sepCls, navBurgerBtnCls, navDividerCls, navbar } from '../styles';

export default function MenuBar() {
  const publishDialogRef = useRef<{ open: () => void }>(null);
  const loginDialogRef = useRef<{ open: () => void }>(null);
  const examplesDialogRef = useRef<{ open: () => void }>(null);

  return (
    <div className={navbar.menuContainer}>
      <PublishDialog ref={publishDialogRef} />
      <LoginDialog ref={loginDialogRef} />
      <ExamplesDialog ref={examplesDialogRef} />

      {/* Desktop */}
      <div className="hidden md:flex items-center gap-0.5">
        <Menu as="div" title="FileMenu">
          <MenuButton className={navBtnCls}>File</MenuButton>
          <MenuItems unmount={false} anchor="bottom start" className={dropdownCls}>
            <MenuItem className={itemCls} as={NewDiagramButton} />
            <MenuItem className={itemCls} as={OpenButton} />
            <MenuItem className={itemCls} as={ExamplesButton} dialog={examplesDialogRef} />
            <MenuItem className={itemCls} as={SaveButton} />
            <MenuSeparator className={sepCls} />
            <MenuItem className={itemCls} as={ExportButton} fileType="svg" />
            <MenuItem className={itemCls} as={ExportButton} fileType="png" />
            <MenuSeparator className={sepCls} />
            <MenuItem className={itemCls} as={LoginButton} dialog={loginDialogRef} />
            <MenuItem className={itemCls} as={PublishButton} dialog={publishDialogRef} />
          </MenuItems>
        </Menu>

        <Menu as="div" title="ViewMenu">
          <MenuButton className={navBtnCls}>View</MenuButton>
          <MenuItems unmount={false} anchor="bottom start" className={dropdownCls}>
            <MenuItem className={itemCls} as={ResetZoomButton} />
          </MenuItems>
        </Menu>

        <Menu as="div" title="HelpMenu">
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

        <div className={navDividerCls} />
        <Menu as="div" title="SimulateMenu">
          <SimulateButton className="" />
        </Menu>
        <Menu as="div" title="RunMenu">
          <RunButton className="" />
        </Menu>

      </div>

      {/* Mobile */}
      <Menu as="div" title="MobileMenu" className="md:hidden">
        <MenuButton className={navBurgerBtnCls} aria-label="Menu">
          <i className="iconify bi--three-dots-vertical text-lg"></i>
        </MenuButton>
        <MenuItems unmount={false} anchor="bottom end" className={dropdownCls}>
          <MenuItem className={itemCls} as={NewDiagramButton} />
          <MenuItem className={itemCls} as={OpenButton} />
          <MenuItem className={itemCls} as={ExamplesButton} dialog={examplesDialogRef} />
          <MenuItem className={itemCls} as={SaveButton} />
          <MenuSeparator className={sepCls} />
          <MenuItem className={itemCls} as={ExportButton} fileType="svg" />
          <MenuItem className={itemCls} as={ExportButton} fileType="png" />
          <MenuSeparator className={sepCls} />
          <MenuItem className={itemCls} as={LoginButton} dialog={loginDialogRef} />
          <MenuItem className={itemCls} as={PublishButton} dialog={publishDialogRef} />
          <MenuSeparator className={sepCls} />
          <MenuItem className={itemCls} as={ResetZoomButton} />
          <MenuSeparator className={sepCls} />
          <MenuItem>
            <a href="./docs" target="_blank" className={`block ${itemCls}`}>Docs</a>
          </MenuItem>
          <MenuItem>
            <a href="https://github.com/behaverse/studyflow-modeler" target="_blank" className={`block ${itemCls}`}>GitHub</a>
          </MenuItem>
        </MenuItems>
      </Menu>

    </div>
  );
}
