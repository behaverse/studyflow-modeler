/**
 * The app's popup menu — one component, every menu id.
 *
 * `editor/popupMenus.ts` is the socket: a caller names a menu and hands over
 * anchor geometry, and this renders it. See `PopupMenus.tsx` for the four
 * registrations.
 *
 * Two variants, because two shapes of menu are all the three ids need:
 *
 * - `list` — grouped icon + label rows, searchable once the list is long enough,
 *   arrow-key navigable, and press-draggable (a row can start a create drag the
 *   same way a palette tile does);
 * - `swatches` — a colour grid.
 *
 * Anchoring: `position` is in CLIENT coordinates (what `view.getAbsoluteBBox`
 * returns, and what the palette computes from a button rect), so the panel is
 * `position: fixed` and clamped into the viewport after measuring.
 */

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { DRAG_THRESHOLD } from '@modeler/palette/usePaletteDrag';
import { PaletteIcon } from '@modeler/palette/PaletteIcon';
import { popupMenu as s } from '@modeler/popup/styles';
import type { PopupPosition } from '@modeler/editor/popupMenus';

/** One row (list variant) or one swatch (swatches variant). */
export type PopupMenuItem = {
  id: string;
  label: string;
  /** Tooltip; falls back to `label`. */
  title?: string;
  /** Iconify class or image URL — list variant only. */
  icon?: string;
  /** Fill/stroke pair — swatches variant only. `undefined` means "clear it". */
  swatch?: { fill?: string; stroke?: string };
  /** Extra text the search box matches on top of `label`. */
  keywords?: string;
  onSelect: (event: ReactMouseEvent) => void;
  /** Press-drag alternative to `onSelect` (drag-to-place). */
  onDragStart?: (event: ReactMouseEvent) => void;
};

export type PopupMenuSection = {
  id: string;
  /** Omitted for a single unnamed section (the colour grid). */
  name?: string;
  items: PopupMenuItem[];
};

export type PopupMenuModel = {
  title?: string;
  /** Panel width in px, as the opener asked for it. */
  width?: number;
  variant?: 'list' | 'swatches';
  /**
   * Forces the search field on. Left unset, a list grows one once it passes
   * {@link SEARCH_THRESHOLD} rows — the opener's `search` option is a floor, not a
   * ceiling, because the caller cannot know how long the catalog made the menu.
   */
  search?: boolean;
  emptyText?: string;
  sections: PopupMenuSection[];
};

/** Rows above which a list gets a search field whether or not one was requested. */
export const SEARCH_THRESHOLD = 8;

const MARGIN = 8;
const DEFAULT_WIDTH = 260;
const MAX_HEIGHT = 420;

type Props = {
  anchor: PopupPosition;
  menu: PopupMenuModel;
  onClose: () => void;
};

function matches(item: PopupMenuItem, terms: string[]): boolean {
  const haystack = `${item.label} ${item.keywords ?? ''}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/** Clamp the panel into the viewport once it has a measured size. */
function usePanelPosition(anchor: PopupPosition, deps: unknown[]) {
  const ref = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.max(MARGIN, Math.min(anchor.x, window.innerWidth - width - MARGIN));
    const top = Math.max(MARGIN, Math.min(anchor.y, window.innerHeight - height - MARGIN));
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    el.style.visibility = 'visible';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor.x, anchor.y, ...deps]);

  return ref;
}

export function PopupMenu({ anchor, menu, onClose }: Props) {
  const variant = menu.variant ?? 'list';
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const pressed = useRef(false);
  const dragged = useRef(false);
  const pressPos = useRef({ x: 0, y: 0 });

  const total = useMemo(
    () => menu.sections.reduce((n, section) => n + section.items.length, 0),
    [menu.sections],
  );
  const showSearch = variant === 'list' && (menu.search === true || total > SEARCH_THRESHOLD);

  const sections = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return menu.sections;
    return menu.sections
      .map((section) => ({ ...section, items: section.items.filter((item) => matches(item, terms)) }))
      .filter((section) => section.items.length > 0);
  }, [menu.sections, query]);

  // Flat order is what the arrow keys walk; the sections are only a heading. Rows
  // carry their flat index so rendering does not go looking for it.
  const { flat, indexed } = useMemo(() => {
    const list: PopupMenuItem[] = [];
    const rows = sections.map((section) => ({
      ...section,
      items: section.items.map((item) => ({ item, index: list.push(item) - 1 })),
    }));
    return { flat: list, indexed: rows };
  }, [sections]);
  const active = flat[Math.min(activeIndex, flat.length - 1)];

  const ref = usePanelPosition(anchor, [showSearch, sections]);

  useEffect(() => {
    if (showSearch) searchRef.current?.focus();
  }, [showSearch]);

  useEffect(() => {
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (flat.length === 0) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % flat.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((i) => (i - 1 + flat.length) % flat.length);
      } else if (event.key === 'Enter' && active) {
        event.preventDefault();
        active.onSelect(event as unknown as ReactMouseEvent);
        onClose();
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [ref, onClose, flat, active]);

  /* Press-drag vs click, mirroring `palette/usePaletteDrag`: the first move with
     the button down starts the drag, and the click that follows is swallowed. */
  const itemHandlers = (item: PopupMenuItem) => ({
    onPointerDown: (event: ReactPointerEvent) => {
      pressed.current = true;
      dragged.current = false;
      pressPos.current = { x: event.clientX, y: event.clientY };
      event.preventDefault();
    },
    onPointerMove: (event: ReactPointerEvent) => {
      if (!item.onDragStart || !pressed.current || dragged.current) return;
      const { x, y } = pressPos.current;
      if (Math.hypot(event.clientX - x, event.clientY - y) < DRAG_THRESHOLD) return;
      dragged.current = true;
      event.preventDefault();
      item.onDragStart(event);
      onClose();
    },
    onPointerUp: () => { pressed.current = false; },
    onClick: (event: ReactMouseEvent) => {
      event.preventDefault();
      pressed.current = false;
      if (dragged.current) {
        dragged.current = false;
        return;
      }
      item.onSelect(event);
      onClose();
    },
  });

  return (
    <div
      ref={ref}
      className={s.panel}
      style={{
        left: anchor.x,
        top: anchor.y,
        visibility: 'hidden',
        // A swatch row sizes to its chips; only the list variant takes a set width.
        width: variant === 'swatches' ? undefined : (menu.width ?? DEFAULT_WIDTH),
        maxHeight: MAX_HEIGHT,
      }}
      role="dialog"
      aria-label={menu.title ?? 'Menu'}
      data-testid="popup-menu"
    >
      {menu.title && <div className={s.header}>{menu.title}</div>}

      {showSearch && (
        <div className={s.searchRow}>
          <span className={s.searchIcon} aria-hidden="true" />
          <input
            ref={searchRef}
            type="text"
            className={s.searchInput}
            placeholder="Search elements..."
            aria-label="Search elements"
            data-testid="popup-menu-search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              // The old highlight indexes into a list that no longer exists.
              setActiveIndex(0);
            }}
          />
        </div>
      )}

      {flat.length === 0 && (
        <div className={s.empty}>{menu.emptyText ?? 'No matching elements'}</div>
      )}

      {variant === 'swatches' && flat.length > 0 && (
        <div className={s.swatchGrid}>
          {flat.map((item, index) => (
            <button
              key={item.id}
              type="button"
              title={item.title ?? item.label}
              aria-label={item.title ?? item.label}
              data-testid={`popup-menu-entry-${item.id}`}
              className={`${s.swatchItem} ${index === activeIndex ? s.swatchItemActive : ''}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={(event) => { item.onSelect(event); onClose(); }}
            >
              <span
                className={s.swatchChip}
                style={{
                  backgroundColor: item.swatch?.fill,
                  borderColor: item.swatch?.stroke,
                }}
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      )}

      {variant === 'list' && flat.length > 0 && (
        <div className={s.list}>
          {indexed.map((section) => (
            <div key={section.id}>
              {section.name && <div className={s.groupLabel}>{section.name}</div>}
              {section.items.map(({ item, index }) => {
                return (
                  <button
                    key={item.id}
                    type="button"
                    title={item.title ?? item.label}
                    data-testid={`popup-menu-entry-${item.id}`}
                    className={`${s.item} ${index === activeIndex ? s.itemActive : ''}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    {...itemHandlers(item)}
                  >
                    <span className={s.itemIcon}>
                      <PaletteIcon icon={item.icon} size={18} />
                    </span>
                    <span className={s.itemLabel}>{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
