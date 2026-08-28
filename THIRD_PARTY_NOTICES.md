# Third-party notices

This project bundles or derives from the following third-party packages.

## diagram-js (MIT)

(c) 2014-present Camunda Services GmbH — https://github.com/bpmn-io/diagram-js

diagram-js is not a dependency of this project, but the wheel pan/zoom handling in
`packages/canvas/src/Canvas.ts` (`handleWheel` / `zoomStep`) is adapted from
diagram-js's `ZoomScroll` (`lib/navigation/zoomscroll/ZoomScroll.js`), and several
interaction constants and behaviors across `packages/canvas` intentionally match
diagram-js for UX parity.

## moddle, bpmn-moddle, moddle-xml (MIT)

(c) bpmn.io contributors — https://github.com/bpmn-io

Used as dependency for reading/writing BPMN files.

## bpmn-auto-layout (MIT)

(c) bpmn.io contributors — https://github.com/bpmn-io/bpmn-auto-layout

Used as dependency for automatic diagram layout.

## bpmn-in-color (bioc attributes)

Element colors are serialized using the BPMN in Color (BIOC) extension attributes (`bioc:*`) defined by the bpmn.io project.

## Icons

Copyright (c) 2020-PRESENT Iconify - https://iconify.design
Copyright (c) The Bootstrap Authors - https://github.com/twbs/icons

The icons used in the apps are derived from the Bootstrap Icons and Iconify projects. Some of the icons are licensed under the MIT license, and some are licensed under the Apache License 2.0.

## BIDS logo

The BIDS (Brain Imaging Data Structure) wordmark is embedded as SVG path data, used only to identify BIDS-formatted datasets. see BIDS Project - https://bids.neuroimaging.io

---

MIT License text (applies to the MIT-licensed items above):

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
