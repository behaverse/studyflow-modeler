import { Menu, MenuItems, MenuButton, MenuItem } from '@headlessui/react'

export default function ExtraMenuItem() {

    return (
        <>
            <Menu as="div" title="More info">
                <MenuButton className="shadow-sm h-9 bg-stone-200 hover:bg-stone-300 border border-stone-300 text-black rounded py-1 px-3 ms-1">
                    <i className="bi bi-three-dots text-black"></i></MenuButton>
                <MenuItems anchor="bottom end" className="w-52 bg-stone-200 border border-stone-300 rounded-lg [--anchor-gap:4px]">
                    <MenuItem>
                        <a href="../docs" target="_blank" className="p-2 block data-[focus]:bg-stone-300">Docs</a>
                    </MenuItem>
                    <MenuItem>
                        <a href="https://github.com/behaverse/studyflow-modeler" target="_blank" className="p-2 block data-[focus]:bg-stone-300">GitHub</a>
                    </MenuItem>
                </MenuItems>
            </Menu>
        </>
    );

}

