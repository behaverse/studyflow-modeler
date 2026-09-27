/**
 * The jsdom page's `HTMLElement` and `customElements`, lent to Node for the rest of the worker, so a module that
 * defines a custom element at load (`src/element.ts`) can be imported by a spec. Import it before that module.
 */

import { installDocument } from './canvasHarness';

const page = installDocument().defaultView!;
Object.assign(globalThis, { HTMLElement: page.HTMLElement, customElements: page.customElements });
