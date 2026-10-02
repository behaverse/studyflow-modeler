import { expect, test } from '@playwright/test';

import type { Editor } from '@modeler/editor/port';
import { publishStudy } from '@skills/behaverse/modeler/publish';

test('publishing posts the study under its name, encoded as one path segment, and hands back the preview link', async () => {
  const posted: { url: string; init: RequestInit }[] = [];
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    posted.push({ url, init });
    return new Response(JSON.stringify({ data: { preview_url: 'https://example.org/preview' } }));
  }) as typeof fetch;
  try {
    const modeler = { saveXML: async () => ({ xml: '<definitions/>' }) } as unknown as Editor;
    const result = await publishStudy(modeler, 'pilot 2/b?', 'k');
    expect(result).toEqual({ previewUrl: 'https://example.org/preview' });
    expect(posted.map(({ url }) => url)).toEqual(['https://api.behaverse.org/v1/studies/pilot%202%2Fb%3F/flow']);
    expect(posted[0].init.body).toBe('<definitions/>');
  } finally {
    globalThis.fetch = fetchBefore;
  }
});
