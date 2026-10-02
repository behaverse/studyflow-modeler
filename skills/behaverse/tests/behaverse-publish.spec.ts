import type { Page, Request } from '@playwright/test';
import { expect, test } from '@tests/e2e';

import { diagramTitle, gotoModeler, runPaletteCommand } from '@tests/utils';

/** The modeler's Behaverse account (Settings > Behaverse) and its "Save" to the Behaverse server, against a stand-in
 * for the server: its sign-in window hands the page a key, and publishing posts the study with it. */

const SERVER = 'https://api.behaverse.org';
const KEY = 'test-key-not-real';
const EMAIL = 'tester@example.org';
const PREVIEW = `${SERVER}/v1/studies/pilot-study/preview`;

async function openAccount(page: Page) {
  await runPaletteCommand(page, /^Settings/);
  const settings = page.getByTestId('settings-view');
  await settings.getByRole('navigation').getByRole('button', { name: 'Behaverse' }).click();
  return settings;
}

async function openCloudSave(page: Page) {
  await runPaletteCommand(page, /^Save As/);
  const dialog = page.getByTestId('save-dialog');
  await dialog.getByTestId('save-to-cloud').click();
  return dialog;
}

test('signed in from Settings, a study is published to the Behaverse server with the key the sign-in handed back, which signing out forgets', async ({ context, page }) => {
  const published: Request[] = [];
  // Every request to the server meets the stand-in, popups' included; nothing leaves the machine.
  await context.route(`${SERVER}/**`, (route) => {
    const { pathname } = new URL(route.request().url());
    // Once Google is done with it, the sign-in window hands its opener the account's key and email.
    if (pathname === '/v1/auth/google/login') {
      const login = JSON.stringify({ type: 'behaverse:login', api_key: KEY, email: EMAIL });
      return route.fulfill({ contentType: 'text/html', body: `<script>window.opener.postMessage(${login}, '*');</script>` });
    }
    if (pathname.endsWith('/flow')) {
      published.push(route.request());
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { preview_url: PREVIEW } }) });
    }
    return route.abort();
  });
  await gotoModeler(page);
  await diagramTitle(page).click();
  await page.getByTestId('diagram-name-input').fill('Pilot study');
  await page.getByTestId('diagram-name-input').press('Enter');

  let settings = await openAccount(page);
  await expect(settings).toContainText('You are working as a guest.');
  const popup = page.waitForEvent('popup');
  await settings.getByRole('button', { name: 'Login with Google' }).click();
  const login = await popup;
  await expect(settings).toContainText(`Signed in as ${EMAIL}`);
  // The page closes the sign-in window once it has the key.
  await expect.poll(() => login.isClosed()).toBe(true);
  await page.keyboard.press('Escape');

  let dialog = await openCloudSave(page);
  await expect(dialog.getByLabel('Behaverse API key')).toHaveValue(KEY);
  await dialog.getByLabel('Study name').fill('pilot-study');
  await dialog.getByTestId('save-submit').click();
  await expect(dialog).toContainText('Published. Open the preview to check it.');
  await expect(dialog.getByRole('link', { name: 'Preview' })).toHaveAttribute('href', PREVIEW);

  // The server got the study as BPMN XML, under the name given, with the key.
  expect(published).toHaveLength(1);
  expect(published[0].method()).toBe('POST');
  expect(published[0].url()).toBe(`${SERVER}/v1/studies/pilot-study/flow`);
  expect(await published[0].allHeaders()).toMatchObject({ authorization: `Bearer ${KEY}`, 'content-type': 'text/xml' });
  expect(published[0].postData()).toMatch(/^<\?xml[\s\S]*definitions[\s\S]*name="Pilot study"/);
  await page.keyboard.press('Escape');

  settings = await openAccount(page);
  await settings.getByRole('button', { name: 'Sign out' }).click();
  await expect(settings).toContainText('You are working as a guest.');
  await page.keyboard.press('Escape');
  dialog = await openCloudSave(page);
  await expect(dialog.getByLabel('Behaverse API key')).toHaveValue('');
});
