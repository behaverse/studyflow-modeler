/**
 * Icon glyph cache: the app's async icon pipeline behind a **synchronous** lookup,
 * so the canvas can draw real SVG glyphs while it paints (parity addendum 6 §1).
 *
 * The canvas renderer is synchronous — `IconResolver` has to answer during a draw —
 * but a glyph body comes from the network (`export/iconSource.ts` fetches it from the
 * Iconify API). This module bridges the two: {@link lookupIcon} answers instantly
 * from the cache and, on a miss, kicks off the fetch and tells its listeners when the
 * body lands so the drawn element can be re-drawn with the real glyph in place of the
 * CSS-class placeholder.
 *
 * {@link primeIconCache} warms it at startup with every class the catalog can produce,
 * which means the common case resolves before the first diagram is even imported.
 *
 * This replaces the old export-time substitution (`embedIconsInSvg`): the scene now
 * carries real `<path>` glyphs, so a serialized SVG is self-contained with no
 * post-processing at all.
 */

import { getCatalog, hasCatalog, isImageIcon } from '@core/notation';
import { BPMN_ICON_OVERRIDES, MARKER_ICONS } from '@modeler/draw/icons';
import { remoteIconSource, type IconSvg } from '@modeler/export/iconSource';

export type { IconSvg };

/** Resolved glyph bodies. A `null` entry means "asked, and it will not resolve". */
const glyphs = new Map<string, IconSvg | null>();

/** Classes whose fetch is in flight, so a repeated miss does not re-request. */
const inFlight = new Set<string>();

const listeners = new Set<(iconClass: string) => void>();

/**
 * Only a class naming an iconify glyph (`collection--name`) can be fetched; an image
 * URL or a bare utility class stays with the CSS placeholder, as it always has.
 */
function isFetchable(iconClass: string): boolean {
  if (!iconClass || isImageIcon(iconClass)) return false;
  return iconClass.split(' ').some((part) => part.includes('--'));
}

/** Quarter-turn rotations expressed as Tailwind utility classes on an icon. */
const ROTATIONS: Record<string, number> = {
  'rotate-90': 90,
  'rotate-180': 180,
  'rotate-270': 270,
  '-rotate-90': -90,
};

/**
 * Re-apply the parts of the class list that are geometry rather than glyph identity.
 *
 * `MARKER_ICONS.parallel` is `"…hamburger-menu-linear rotate-90"`: the CSS pipeline
 * rotated the box, and a raw glyph body knows nothing about that — so the rotation is
 * baked into the drawn body instead, around the viewBox centre.
 */
function applyModifiers(iconClass: string, icon: IconSvg): IconSvg {
  const turn = iconClass.split(' ').map((part) => ROTATIONS[part]).find((deg) => deg !== undefined);
  if (!turn) return icon;

  const [minX = 0, minY = 0, width = 24, height = 24] = icon.viewBox.split(/[\s,]+/).map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return icon;
  const cx = minX + width / 2;
  const cy = minY + height / 2;
  return { ...icon, content: `<g transform="rotate(${turn} ${cx} ${cy})">${icon.content}</g>` };
}

/**
 * Subscribe to glyph arrivals. The callback names the class that resolved, so the
 * caller can re-draw whatever was waiting on it. Returns an unsubscribe function.
 */
export function onIconResolved(listener: (iconClass: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce(iconClass: string): void {
  for (const listener of listeners) listener(iconClass);
}

/**
 * Start resolving `iconClass` if it is fetchable and not already known or in flight.
 * Fire-and-forget: the result reaches callers through {@link lookupIcon} plus an
 * {@link onIconResolved} notification.
 */
export function requestIcon(iconClass: string): void {
  if (!isFetchable(iconClass) || glyphs.has(iconClass) || inFlight.has(iconClass)) return;
  inFlight.add(iconClass);
  void remoteIconSource.resolve(iconClass)
    .then((icon) => {
      glyphs.set(iconClass, icon ? applyModifiers(iconClass, icon) : null);
      if (icon) announce(iconClass);
    })
    .catch(() => {
      glyphs.set(iconClass, null);
    })
    .finally(() => {
      inFlight.delete(iconClass);
    });
}

/**
 * The glyph body for `iconClass` if it is already cached, otherwise `undefined` —
 * and, on a miss, a fetch is started so a later draw can have it. Never throws and
 * never blocks: this is what a synchronous renderer can call.
 */
export function lookupIcon(iconClass: string): IconSvg | undefined {
  const hit = glyphs.get(iconClass);
  if (hit !== undefined) return hit ?? undefined;
  requestIcon(iconClass);
  return undefined;
}

/**
 * Every icon class the installed schemas can produce: the catalog's type and template
 * icons plus the built-in BPMN type and activity-marker glyphs. Empty before the
 * schemas are installed — priming is safe to call either way.
 */
export function catalogIconClasses(): string[] {
  const classes = new Set<string>([
    ...Object.values(BPMN_ICON_OVERRIDES),
    ...Object.values(MARKER_ICONS),
  ]);
  if (hasCatalog()) {
    const catalog = getCatalog();
    for (const entry of catalog.allTypes()) if (entry.iconClass) classes.add(entry.iconClass);
    for (const template of catalog.allTemplates()) {
      for (const icon of [template.iconClass, template.overrideIconClass]) if (icon) classes.add(icon);
    }
  }
  return [...classes].filter(isFetchable);
}

/**
 * Warm the cache with `classes` (the whole catalog by default). Purely additive: a
 * class already cached or in flight is skipped, so calling it twice costs nothing.
 */
export function primeIconCache(classes: Iterable<string> = catalogIconClasses()): void {
  for (const iconClass of classes) requestIcon(iconClass);
}
