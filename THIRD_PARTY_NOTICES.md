# Third-party notices

This project bundles or derives from the following third-party packages.

## diagram-js (MIT)

(c) 2014-present Camunda Services GmbH — https://github.com/bpmn-io/diagram-js

diagram-js is not a dependency of this project, but the wheel pan/zoom handling in
`packages/canvas/src/interaction/pan.ts` (`Pan.wheel`, `ZOOM_STEP`) is adapted from
diagram-js's `ZoomScroll` (`lib/navigation/zoomscroll/ZoomScroll.js`), and several
interaction constants and behaviors across `packages/canvas` intentionally match
diagram-js for UX parity.

## moddle, bpmn-moddle, moddle-xml (MIT)

(c) bpmn.io contributors — https://github.com/bpmn-io

Used as dependency for reading/writing BPMN files.

## bpmn-in-color (bioc attributes)

Element colors are serialized using the BPMN in Color (BIOC) extension attributes (`bioc:*`) defined by the bpmn.io project.

## Icons

Copyright (c) 2020-PRESENT Iconify - https://iconify.design
Copyright (c) Paweł Kuna - https://github.com/tabler/tabler-icons
Copyright (c) Phosphor Icons - https://github.com/phosphor-icons/core
Copyright (c) Lucide Contributors - https://github.com/lucide-icons/lucide
Copyright (c) Pictogrammers - https://github.com/Templarian/MaterialDesign
Copyright (c) Camunda Services GmbH - https://github.com/bpmn-io/bpmn-font

The icons used in the apps come from five sets, read through the Iconify project: Tabler Icons and Phosphor, under the MIT license; Lucide, under the ISC license; Material Design Icons, under the Apache License 2.0; and the BPMN font, under the SIL Open Font License 1.1.

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
