/**
 * The app's popup menu: one component for every menu id.
 *
 * A caller names a menu through `editor/popupMenus.ts` and hands over anchor geometry, and this renders it. See
 * `PopupMenus.tsx` for the four registrations.
 *
 * It has two variants:
 *
 * - `list`: grouped icon and label rows, searchable once the list is long enough, narrowed by a row of filters
 *   when it has them, navigable with the arrow keys, and press-draggable (a row can start a create drag as a palette
 *   tile does). A row may end in a tag (where it comes from) and a pin (the Add panel's, to the tools column). A
 *   section may lay its items out as cards instead, each a picture with its label under it, and a menu may switch
 *   between views of its sections (the Add panel's Elements and Templates);
 * - `swatches`: rows of small square buttons, one row per section: a colour chip where the item carries a
 *   `swatch`, a glyph where it carries one. The style menu has all three kinds of row (element colours, the text
 *   toggles, the text inks).
 *
 * Anchoring: `position` is in client coordinates (what `canvas.screenBox` returns, and what the palette computes
 * from a button rect), so the panel is `position: fixed` and clamped into the viewport after measuring. It is placed
 * once, as it opens: a search that narrows the list shortens it from the bottom, and the field stays where it was.
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
import { ICONS } from '@modeler/icons';
import { popupMenu as s } from '@modeler/popup/styles';
import { matchesTerms, wordsOf } from '@modeler/popup/search';
import { choice } from '@modeler/ui/styles';
import { uiScale } from '@modeler/ui/scale';
import type { PopupPosition } from '@modeler/editor/popupMenus';

/** One row (list variant) or one swatch (swatches variant). */
export type PopupMenuItem = {
  id: string;
  label: string;
  /** Tooltip; falls back to `label`. */
  title?: string;
  /** Iconify class or image URL; list variant only. */
  icon?: string;
  /** Fill/stroke pair; swatches variant only. `undefined` clears it. */
  swatch?: { fill?: string; stroke?: string };
  /** Iconify class drawn in place of a chip; swatches variant only. */
  glyph?: string;
  /** A toggle's state, drawn as the pressed style and reported as `aria-pressed`. */
  pressed?: boolean;
  /**
   * Leaves the menu open after this item runs. Every entry of the style menu sets it, because styling takes
   * several clicks (bold, then italic, then an ink) and the pressed state is only shown while the menu is up.
   */
  keepOpen?: boolean;
  /** Extra text the search box matches on top of `label`. */
  keywords?: string;
  /** A word or two at the row's end, muted: the skill an element comes from. List variant only. */
  tag?: string;
  /** The filter (`PopupMenuModel.filters`) the row answers to. */
  filter?: string;
  /** A pin at the row's end: whether the row is pinned (to the tools column), and the toggle. */
  pin?: { pinned: boolean; toggle: () => void };
  /** A card's picture of what the item adds, as an image URL; asked for when the card is first drawn. */
  picture?: () => string | undefined;
  onSelect: (event: ReactMouseEvent) => void;
  /** Press-drag alternative to `onSelect` (drag-to-place). */
  onDragStart?: (event: ReactMouseEvent) => void;
};

export type PopupMenuSection = {
  id: string;
  /** Omitted for a single unnamed section. */
  name?: string;
  /** The view (`PopupMenuModel.views`) the section is shown in; without one, every view shows it. */
  view?: string;
  /** `cards`: its items two to a row, each a picture with its label and tag under it. */
  layout?: 'list' | 'cards';
  items: PopupMenuItem[];
};

export type PopupMenuModel = {
  title?: string;
  /** Panel width in px, as the opener asked for it. */
  width?: number;
  variant?: 'list' | 'swatches';
  /**
   * Forces the search field on. Left unset, a list still gets one once it passes {@link SEARCH_THRESHOLD} rows,
   * because the caller cannot know how long the catalog made the menu.
   */
  search?: boolean;
  /** The search field's prompt, "Search..." without one. */
  placeholder?: string;
  /** Choices under the search, after "All", each narrowing the list to the rows that name it (`PopupMenuItem.filter`). */
  filters?: { id: string; label: string }[];
  /**
   * A switch under the search between views of the sections (`PopupMenuSection.view`), the first shown first, each
   * with its own search prompt. A view with nothing in it is left out, and the switch with it when one is left.
   */
  views?: { id: string; label: string; placeholder?: string }[];
  emptyText?: string;
  sections: PopupMenuSection[];
};

/** Rows above which a list gets a search field whether or not one was requested. */
const SEARCH_THRESHOLD = 8;

const MARGIN = 8;

/* Base-scale sizes (16.25rem / 26.25rem). The menu's contents are rem-sized, so
   the box has to be too, or a 4K screen gets 20px labels in a 260px column. */
const DEFAULT_WIDTH = 260;
const MAX_HEIGHT = 420;

type Props = {
  anchor: PopupPosition;
  menu: PopupMenuModel;
  onClose: () => void;
};

function matches(item: PopupMenuItem, terms: readonly string[]): boolean {
  return matchesTerms(`${item.label} ${item.keywords ?? ''}`, terms);
}

/**
 * The lowest a panel spanning [left, right] may reach: 8 above the window's bottom, or 8 above a bar there that covers
 * the bottom edge (`data-covers="bottom"`: the composer), as the canvas keeps clear of the chrome.
 */
function floorFor(left: number, right: number): number {
  let floor = window.innerHeight - MARGIN;
  for (const bar of document.querySelectorAll<HTMLElement>('[data-covers="bottom"]')) {
    const box = bar.getBoundingClientRect();
    if (box.width === 0 || box.right < left || box.left > right) continue;
    floor = Math.min(floor, box.top - MARGIN);
  }
  return floor;
}

/** Clamp the panel into the room it has once it has a measured size: the viewport, clear of the bottom bar. */
function usePanelPosition(anchor: PopupPosition, deps: unknown[]) {
  const ref = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.max(MARGIN, Math.min(anchor.x, window.innerWidth - width - MARGIN));
    const floor = floorFor(left, left + width);
    const top = Math.max(MARGIN, Math.min(anchor.y, floor - height));
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    // Taller than the room: its list scrolls within it.
    el.style.maxHeight = `${Math.round(Math.min(el.offsetHeight, floor - top))}px`;
    el.style.visibility = 'visible';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor.x, anchor.y, ...deps]);

  return ref;
}

export function PopupMenu({ anchor, menu, onClose }: Props) {
  const variant = menu.variant ?? 'list';
  const [query, setQuery] = useState('');
  /** The filter chosen, `''` for all. */
  const [filter, setFilter] = useState('');
  /** The view chosen; the first with something in it until one is. */
  const [chosenView, setChosenView] = useState<string>();
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

  const views = useMemo(
    () => (menu.views ?? []).filter((view) => menu.sections.some((section) => section.view === view.id && section.items.length > 0)),
    [menu.views, menu.sections],
  );
  const view = views.find((option) => option.id === chosenView) ?? views[0];
  const shown = useMemo(
    () => (view ? menu.sections.filter((section) => !section.view || section.view === view.id) : menu.sections),
    [menu.sections, view],
  );
  // Filters narrow the rows that name one: a view whose rows name none shows no filters.
  const filters = shown.some((section) => section.items.some((item) => item.filter)) ? menu.filters ?? [] : [];

  const sections = useMemo(() => {
    const terms = wordsOf(query);
    if (terms.length === 0 && !filter) return shown;
    return shown
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => (!filter || item.filter === filter) && matches(item, terms)),
      }))
      .filter((section) => section.items.length > 0);
  }, [shown, query, filter]);

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

  const ref = usePanelPosition(anchor, [showSearch]);

  useEffect(() => {
    if (showSearch) searchRef.current?.focus();
  }, [showSearch]);

  useEffect(() => {
    const onPointerDown = (event: globalThis.PointerEvent) => {
      // A press on the button that opened the menu is left to its click, which closes it: closed here first, the
      // click would open it again.
      if ((event.target as Element).closest?.('[data-popup-toggle]')) return;
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
        if (!active.keepOpen) onClose();
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
    onPointerCancel: () => { pressed.current = false; },
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
        width: variant === 'swatches' ? undefined : (menu.width ?? DEFAULT_WIDTH) * uiScale(),
        maxHeight: Math.min(MAX_HEIGHT * uiScale(), window.innerHeight - 2 * MARGIN),
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
            placeholder={view?.placeholder ?? menu.placeholder ?? 'Search...'}
            aria-label="Search"
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

      {variant === 'list' && (views.length > 1 || filters.length > 0) && (
        <div className={s.controls}>
          {views.length > 1 && (
            <div className={choice.track} role="group" aria-label="View">
              {views.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`${choice.base} ${s.view} ${option.id === view?.id ? choice.selected : choice.idle}`}
                  aria-pressed={option.id === view?.id}
                  data-testid={`popup-menu-view-${option.id}`}
                  onClick={() => {
                    setChosenView(option.id);
                    setFilter('');
                    setActiveIndex(0);
                    searchRef.current?.focus();
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
          {filters.length > 0 && (
            <div className={s.filters} role="group" aria-label="Show">
              {[{ id: '', label: 'All' }, ...filters].map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`${choice.base} ${option.id === filter ? choice.selected : choice.idle}`}
                  aria-pressed={option.id === filter}
                  data-testid={`popup-menu-filter-${option.id || 'all'}`}
                  onClick={() => {
                    setFilter(option.id);
                    setActiveIndex(0);
                    // The keys stay with the list: the search field keeps them.
                    searchRef.current?.focus();
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {flat.length === 0 && (
        <div className={s.empty}>{menu.emptyText ?? 'No matching elements'}</div>
      )}

      {variant === 'swatches' && flat.length > 0 && (
        <div className={s.swatchSections}>
          {indexed.map((section) => (
            <div key={section.id}>
              {section.name && <div className={s.groupLabel}>{section.name}</div>}
              <div className={s.swatchGrid}>
                {section.items.map(({ item, index }) => (
                  <button
                    key={item.id}
                    type="button"
                    title={item.title ?? item.label}
                    aria-label={item.title ?? item.label}
                    {...(item.pressed === undefined ? {} : { 'aria-pressed': item.pressed })}
                    data-testid={`popup-menu-entry-${item.id}`}
                    className={`${s.swatchItem} ${index === activeIndex ? s.swatchItemActive : ''} ${item.pressed ? s.swatchItemPressed : ''}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={(event) => {
                      item.onSelect(event);
                      if (!item.keepOpen) onClose();
                    }}
                  >
                    {item.glyph
                      ? <span className={`${item.glyph} ${s.swatchGlyph}`} aria-hidden="true" />
                      : (
                        <span
                          className={s.swatchChip}
                          style={{
                            backgroundColor: item.swatch?.fill,
                            borderColor: item.swatch?.stroke,
                          }}
                          aria-hidden="true"
                        />
                      )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {variant === 'list' && flat.length > 0 && (
        <div className={s.list}>
          {indexed.map((section) => (
            <div key={section.id}>
              {section.name && <div className={s.groupLabel}>{section.name}</div>}
              {section.layout === 'cards' ? (
                <div className={s.cards}>
                  {section.items.map(({ item, index }) => {
                    const picture = item.picture?.();
                    return (
                      <div
                        key={item.id}
                        className={`${s.card} ${index === activeIndex ? s.cardActive : s.cardIdle}`}
                        data-active={index === activeIndex}
                        onMouseEnter={() => setActiveIndex(index)}
                      >
                        <button
                          type="button"
                          title={item.title ?? item.label}
                          data-testid={`popup-menu-entry-${item.id}`}
                          className={s.cardPick}
                          {...itemHandlers(item)}
                        >
                          <span className={s.cardPicture}>
                            {picture
                              ? <img src={picture} alt="" draggable={false} className={s.cardImage} />
                              : <PaletteIcon icon={item.icon} size={28} />}
                          </span>
                          <span className={s.cardLabel}>{item.label}</span>
                          {item.tag && !filter && <span className={s.cardTag}>{item.tag}</span>}
                        </button>
                        {item.pin && (
                          <button
                            type="button"
                            className={item.pin.pinned ? s.cardPinOn : s.cardPin}
                            title={item.pin.pinned ? 'Unpin from the tools' : 'Pin to the tools'}
                            aria-label={`${item.pin.pinned ? 'Unpin' : 'Pin'} ${item.label}`}
                            aria-pressed={item.pin.pinned}
                            data-testid={`popup-menu-pin-${item.id}`}
                            onClick={item.pin.toggle}
                          >
                            <i className={item.pin.pinned ? ICONS.pinned : ICONS.pin} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : section.items.map(({ item, index }) => (
                <div
                  key={item.id}
                  className={`${s.row} ${index === activeIndex ? s.rowActive : ''}`}
                  data-active={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <button
                    type="button"
                    title={item.title ?? item.label}
                    data-testid={`popup-menu-entry-${item.id}`}
                    className={item.pin ? s.itemPinnable : s.item}
                    {...itemHandlers(item)}
                  >
                    <span className={s.itemIcon}>
                      <PaletteIcon icon={item.icon} size={18} />
                    </span>
                    <span className={s.itemLabel}>{item.label}</span>
                    {/* Narrowed to one filter, every row would say the same. */}
                    {item.tag && !filter && <span className={s.itemTag}>{item.tag}</span>}
                  </button>
                  {item.pin && (
                    <button
                      type="button"
                      className={item.pin.pinned ? s.pinOn : s.pin}
                      title={item.pin.pinned ? 'Unpin from the tools' : 'Pin to the tools'}
                      aria-label={`${item.pin.pinned ? 'Unpin' : 'Pin'} ${item.label}`}
                      aria-pressed={item.pin.pinned}
                      data-testid={`popup-menu-pin-${item.id}`}
                      onClick={item.pin.toggle}
                    >
                      <i className={item.pin.pinned ? ICONS.pinned : ICONS.pin} aria-hidden="true" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
