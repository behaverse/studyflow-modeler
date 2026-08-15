import type { IconSvg, IconSource } from '@modeler/export/svgEmbedding';
import { notify } from '@modeler/app/noticeStore';

export type { IconSvg, IconSource };

const FETCH_TIMEOUT_MS = 5000;

const cache = new Map<string, Promise<IconSvg | null>>();

let failedIcons: string[] = [];
let failureFlush: ReturnType<typeof setTimeout> | undefined;

function reportIconFailure(iconClass: string): void {
  failedIcons.push(iconClass);
  clearTimeout(failureFlush);
  failureFlush = setTimeout(() => {
    notify('warning',
      `Some icons could not be downloaded, so the export left them out: ${failedIcons.join(', ')}. `
      + 'Check your connection and export again to include them.');
    failedIcons = [];
  }, 500);
}

async function fetchIcon(iconClass: string): Promise<IconSvg | null> {
  const iconPart = iconClass.split(' ').find((part: string) => part.includes('--'));
  if (!iconPart) return null;

  const [collection, iconName] = iconPart.split('--');
  try {
    const response = await fetch(
      `https://api.iconify.design/${collection}/${iconName}.svg`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    if (!response.ok) return null;

    const svgText = await response.text();
    const svgElement = new DOMParser()
      .parseFromString(svgText, 'image/svg+xml')
      .querySelector('svg');
    if (!svgElement) return null;

    return {
      content: svgElement.innerHTML,
      viewBox: svgElement.getAttribute('viewBox') || '0 0 24 24',
    };
  } catch (err) {
    console.warn(`Could not fetch icon "${iconClass}"; exporting without it.`, err);
    reportIconFailure(iconClass);
    return null;
  }
}

export const remoteIconSource: IconSource = {
  resolve(iconClass: string): Promise<IconSvg | null> {
    const hit = cache.get(iconClass);
    if (hit) return hit;
    const pending = fetchIcon(iconClass);
    cache.set(iconClass, pending);
    return pending;
  },
};

