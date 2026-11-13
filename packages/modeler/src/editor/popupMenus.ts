/**
 * The app's popup menus, keyed by id.
 *
 * `openPopupMenu(providerId, …)` names a menu and hands over anchor geometry; app chrome (`popup/PopupMenus.tsx`)
 * renders it. The ids (`bpmn-create`, `bpmn-append`, `bpmn-replace`, `color-picker`) are the ones the app's chrome
 * and its e2e specs use.
 *
 * Registration is a plain map, so the palette, the context pad and the canvas's `a` key open a menu without
 * importing a component. Opening a menu before it is registered warns once per id and does nothing.
 */

export const CREATE_MENU = 'bpmn-create';
export const APPEND_MENU = 'bpmn-append';
export const REPLACE_MENU = 'bpmn-replace';
/** Element colours and text styles in one menu, opened by the context pad's paintbrush. The id still says `color-picker` because the e2e specs use it. */
export const COLOR_MENU = 'color-picker';

export type PopupPosition = {
  x: number;
  y: number;
  cursor: { x: number; y: number };
};

export type PopupOptions = {
  title?: string;
  width?: number;
  search?: boolean;
};

export type PopupMenuOpener = (position: PopupPosition, options?: PopupOptions) => void;

const menus = new Map<string, PopupMenuOpener>();
const warned = new Set<string>();

/** Register app chrome as the opener for `providerId`; returns the detach function. */
export function registerPopupMenu(providerId: string, open: PopupMenuOpener): () => void {
  menus.set(providerId, open);
  return () => {
    if (menus.get(providerId) === open) menus.delete(providerId);
  };
}

/** Open a registered menu. Unknown ids warn once and do nothing. */
export function openPopupMenu(providerId: string, position: PopupPosition, options?: PopupOptions): void {
  const open = menus.get(providerId);
  if (!open) {
    if (!warned.has(providerId)) {
      warned.add(providerId);
      console.warn(
        `No app chrome registered for the '${providerId}' menu; `
        + 'register one with `registerPopupMenu`.',
      );
    }
    return;
  }
  open(position, options);
}
