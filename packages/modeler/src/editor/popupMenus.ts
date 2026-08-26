/**
 * App-fulfilled popup menus.
 *
 * `EditorPort.popup.open(providerId, …)` names a menu, not a diagram-js provider.
 * The bpmn backend resolves the id through bpmn-js's own popup-menu registry
 * (`bpmn-create`, `bpmn-append`, `color-picker` are registered as diagram-js
 * providers in `bpmn/behaviors.ts`, `contextPad/AppendMenuProvider.ts` and
 * `contextPad/ColorPickerProvider.ts`). A backend with no such registry — the
 * canvas — needs the app chrome to render the same menus at the anchor geometry
 * the editor hands over, so this module is where app chrome registers them.
 *
 * Registration is a plain map so the React layer can own it without the editor
 * knowing anything about React. Until a menu is registered, opening it is a no-op
 * that warns once per id rather than throwing: an unregistered menu must not take
 * the app down.
 */

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
        `No app chrome registered for the '${providerId}' menu on this editor backend; `
        + 'register one with `registerPopupMenu`.',
      );
    }
    return;
  }
  open(position, options);
}
