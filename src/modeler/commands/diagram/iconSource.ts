/**
 * Injectable seam for resolving icon SVGs during export.
 *
 * The SVG/PNG export path embeds icon glyphs into the serialized diagram. By
 * default those glyphs are fetched live from the Iconify API, which makes
 * export depend on the network and impossible to exercise offline / in tests.
 * `IconSource` abstracts that lookup so callers can swap in an offline adapter.
 */

export type IconSvg = { content: string; viewBox: string };

export interface IconSource {
  /** Resolve an icon (e.g. `"i-ph--gear"`) to its inner SVG, or null if unknown. */
  resolve(iconClass: string): Promise<IconSvg | null>;
}

/**
 * Production adapter: fetches the icon SVG live from the Iconify API.
 * This is the exact behavior previously inlined in `saveDiagram.ts`.
 */
export const remoteIconSource: IconSource = {
  async resolve(iconClass: string): Promise<IconSvg | null> {
    const parts = iconClass.split(' ');
    const iconPart = parts.find((p: string) => p.includes('--'));
    if (!iconPart) return null;

    const [collection, iconName] = iconPart.split('--');
    const response = await fetch(`https://api.iconify.design/${collection}/${iconName}.svg`);
    if (!response.ok) return null;

    const svgText = await response.text();
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
    const svgElement = svgDoc.querySelector('svg');
    if (!svgElement) return null;

    return {
      content: svgElement.innerHTML,
      viewBox: svgElement.getAttribute('viewBox') || '0 0 24 24',
    };
  },
};

/**
 * Offline / test adapter: resolves nothing. Icons are simply skipped during
 * export, which keeps the export path deterministic and network-free.
 */
export const bundledIconSource: IconSource = {
  async resolve(_iconClass: string): Promise<IconSvg | null> {
    return null;
  },
};
