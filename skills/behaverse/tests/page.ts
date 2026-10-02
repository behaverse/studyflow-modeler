import { JSDOM, type DOMWindow } from 'jsdom';

/** The runner's page and the build's frame, `page` standing as the global window while `run` runs: the window the
 * page's half of the skill listens on, and whose storage holds the account. */
export async function inPage(run: (page: DOMWindow, frame: DOMWindow) => Promise<void>): Promise<void> {
  const page = new JSDOM('', { url: 'http://127.0.0.1/run/' }).window;
  const frame = new JSDOM('', { url: 'http://127.0.0.1/run/assessment-unity/' }).window;
  const host = globalThis as { window?: unknown };
  const before = host.window;
  host.window = page;
  try {
    await run(page, frame);
  } finally {
    host.window = before;
    page.close();
    frame.close();
  }
}

/** Posts `data` to the page, as the build does from its frame, and waits until the page has had it. */
export function posted(page: DOMWindow, data: unknown): Promise<void> {
  return new Promise((resolve) => {
    page.addEventListener('message', () => resolve(), { once: true });
    page.postMessage(data, '*');
  });
}
