/**
 * `<studyflow-canvas>`: a canvas as an HTML element, built on the package's index alone (lint-enforced), so it
 * needs nothing a host could not have. A page hands it a study (`element.study = study`), or names a file with
 * `src` once `element.moddle` says how to read one; `readonly` makes it a view to look at. Give it a size.
 * `defineStudyflowCanvas()` registers it.
 */

import { Canvas, Study, type CanvasOptions, type OpenOptions } from './index.ts';

export class StudyflowCanvasElement extends HTMLElement {
  static readonly observedAttributes = ['src', 'readonly'];

  /** Reads the file `src` names: a moddle over the schemas it uses. */
  moddle?: OpenOptions['moddle'];
  /** How the view draws, read when it mounts: the icons, the grid. */
  options: CanvasOptions = {};

  private shown?: Study;
  private view?: Canvas;
  /** Counts the reads `src` starts, so an older one that lands late is dropped. */
  private reads = 0;

  /** The study the element shows. */
  get study(): Study | undefined {
    return this.shown;
  }

  set study(study: Study | undefined) {
    this.shown = study;
    this.mount();
  }

  /** The view on the study, while the element is in a document and has one to show. */
  get canvas(): Canvas | undefined {
    return this.view;
  }

  connectedCallback(): void {
    this.mount();
  }

  disconnectedCallback(): void {
    this.view?.destroy();
    this.view = undefined;
  }

  attributeChangedCallback(name: string): void {
    if (name === 'readonly') this.view?.setEditable(!this.hasAttribute('readonly'));
    if (name === 'src') void this.read();
  }

  /** Read the file `src` names and show it; a `studyflow-error` event says why not. */
  private async read(): Promise<void> {
    const src = this.getAttribute('src');
    if (!src) return;
    const read = ++this.reads;
    try {
      if (!this.moddle) throw new Error('<studyflow-canvas> reads a file with a moddle: set element.moddle first');
      const response = await fetch(src);
      if (!response.ok) throw new Error(`<studyflow-canvas> could not read ${src}: ${response.status}`);
      const study = await Study.open(await response.text(), { moddle: this.moddle });
      if (read === this.reads) this.study = study;
    } catch (error) {
      const view = this.ownerDocument.defaultView;
      if (view) this.dispatchEvent(new view.CustomEvent('studyflow-error', { detail: error }));
    }
  }

  /** Put a view of the study in the element, in place of the last one. */
  private mount(): void {
    this.view?.destroy();
    this.view = undefined;
    if (!this.isConnected || !this.shown) return;
    this.view = new Canvas(this, this.shown, { ...this.options, editable: !this.hasAttribute('readonly') });
  }
}

/** Register `<studyflow-canvas>` (or the element under `name`), once. */
export function defineStudyflowCanvas(name = 'studyflow-canvas'): void {
  if (!customElements.get(name)) customElements.define(name, StudyflowCanvasElement);
}
